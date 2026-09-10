import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio

from speechbrain.lobes.features import Fbank
from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN

class MultiScaleAttentiveStatsPooling(nn.Module):
    """
    Implements a Multi-Scale Attentive Statistics Pooling layer
    with a bottleneck to prevent parameter explosion during fusion.
    """
    def __init__(self, channels, attention_channels=128, scales=(1, 2, 4), global_context=True):
        super().__init__()
        self.scales = scales
        self.global_context = global_context
        
        # Calculate input dimension dynamically
        in_dim = channels * 3 if global_context else channels
        self.tdnn = nn.Conv1d(in_dim, attention_channels, kernel_size=1)
        self.tanh = nn.Tanh()
        self.conv = nn.Conv1d(attention_channels, channels, kernel_size=1)
        
        # Bottleneck to compress the concatenated dimensions before fusion
        concat_dim = channels * 2 * len(scales)
        bottleneck_dim = channels
        
        self.fuse = nn.Sequential(
            nn.Conv1d(concat_dim, bottleneck_dim, kernel_size=1, groups=len(scales)),
            nn.BatchNorm1d(bottleneck_dim),
            nn.GELU(),
            nn.Conv1d(bottleneck_dim, channels * 2, kernel_size=1)
        )

    def _masked_stats(self, x, mask):
        valid_counts = mask.sum(dim=2, keepdim=True).clamp(min=1)
        mean = (x * mask).sum(dim=2, keepdim=True) / valid_counts

        if self.global_context:
            std = (((x - mean) ** 2) * mask).sum(dim=2, keepdim=True) / valid_counts
            std = std.clamp(min=1e-4).sqrt()
            attn_input = torch.cat([x, mean.expand_as(x), std.expand_as(x)], dim=1)
        else:
            attn_input = x

        attn = self.tanh(self.tdnn(attn_input))
        attn = self.conv(attn)
        attn = attn.masked_fill(mask == 0, -1e4)
        attn = F.softmax(attn, dim=2)

        w_mean = torch.sum(x * attn, dim=2)
        w_var = (torch.sum((x ** 2) * attn, dim=2) - w_mean ** 2).clamp(min=1e-4)
        w_std = torch.sqrt(w_var)
        return torch.cat([w_mean, w_std], dim=1).unsqueeze(2)

    def forward(self, x, lengths=None):
        B, C, T = x.shape
        if lengths is None:
            mask = torch.ones(B, 1, T, device=x.device, dtype=x.dtype)
        else:
            valid_len = (lengths.float() * T).long().clamp(min=1, max=T)
            idx = torch.arange(T, device=x.device).view(1, 1, T)
            mask = (idx < valid_len.view(B, 1, 1)).to(x.dtype)

        pooled = []
        for n_segments in self.scales:
            seg_len = max(1, T // n_segments)
            seg_stats = []
            for i in range(n_segments):
                start = i * seg_len
                end = T if i == n_segments - 1 else start + seg_len
                seg_stats.append(self._masked_stats(x[:, :, start:end], mask[:, :, start:end]))
            pooled.append(torch.stack(seg_stats, dim=0).mean(dim=0))

        fused = torch.cat(pooled, dim=1)
        return self.fuse(fused)


class StudentECAPA(nn.Module):
    def __init__(self, scale_fraction=1, input_dim=80, embedding_dim=192):
        super().__init__()
        
        # Feature extractor
        self.compute_features = Fbank(n_mels=input_dim)
        
        # Scale down the channel dimensions
        self.scale_fraction = scale_fraction
        base_channels = [512, 512, 512, 512, 1536]
        self.scaled_channels = [max(16, (int(c * scale_fraction) // 8) * 8) for c in base_channels]
        
        self.encoder = ECAPA_TDNN(
            input_size=input_dim,
            channels=self.scaled_channels,
            lin_neurons=embedding_dim,
        )

        # Replace standard ASP with MultiScaleAttentiveStatsPooling
        self.encoder.asp = MultiScaleAttentiveStatsPooling(
            channels=self.scaled_channels[-1],
            attention_channels=128,
            scales=(1, 2, 4),
            global_context=True,
        )
        
    def forward(self, x, lengths=None):
        # Extract and normalize features
        x = self.compute_features(x)
        x = x - x.mean(dim=1, keepdim=True)
        
        # Extract embeddings
        student_emb = self.encoder(x, lengths)
        
        # Return only the core embedding for inference
        return student_emb.squeeze(1)

    def get_param_count(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)