import React, { useState, useRef, useEffect } from 'react';
import { Home, UserPlus, Users, Radio, ArrowLeft, Trash2, Mic } from 'lucide-react';

// Downsamples a raw PCM buffer into peak amplitude buckets for a lightweight
// static waveform preview (used in the recorded-sample list).
const getPeaks = (pcmData, buckets = 56) => {
    if (!pcmData || pcmData.length === 0) return new Array(buckets).fill(0.04);
    const blockSize = Math.max(1, Math.floor(pcmData.length / buckets));
    const peaks = [];
    for (let i = 0; i < buckets; i++) {
        const start = i * blockSize;
        let max = 0;
        for (let j = 0; j < blockSize && start + j < pcmData.length; j++) {
            const val = Math.abs(pcmData[start + j]);
            if (val > max) max = val;
        }
        peaks.push(Math.max(0.04, Math.min(1, max * 1.6)));
    }
    return peaks;
};

export default function App() {
    const [view, setView] = useState("home");

    // --- State for New Profile ---
    const [profileName, setProfileName] = useState("");
    const [recordings, setRecordings] = useState([]);
    const [isRecording, setIsRecording] = useState(false);
    const [timeLeft, setTimeLeft] = useState(5);

    // --- State for Edit Profiles ---
    const [savedProfiles, setSavedProfiles] = useState([]);

    // --- State for Listen Mode ---
    const [isListening, setIsListening] = useState(false);
    const [currentSpeaker, setCurrentSpeaker] = useState("Nobody");

    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const streamRef = useRef(null);

    // Refs for New Profile Recording
    const recordingBufferRef = useRef([]);

    // Refs for Listen Mode
    const wsRef = useRef(null);
    const analyserRef = useRef(null);
    const canvasRef = useRef(null);
    const animationRef = useRef(null);

    // Common function to init AudioContext
    const initAudioContext = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
    };

    // Cleanup when component unmounts
    useEffect(() => {
        return () => {
            stopRecording();
            stopListening();
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    useEffect(() => {
        if (view === "edit") fetchProfiles();
        if (view !== "listen") stopListening();
        if (view !== "new") stopRecording();
    }, [view]);

    // --- Raw Audio Helper: Convert Float32Array to WAV for browser playback ---
    const createWavBlob = (float32Array, sampleRate) => {
        const numChannels = 1;
        const byteRate = sampleRate * numChannels * 2;
        const blockAlign = numChannels * 2;
        const wavBuffer = new ArrayBuffer(44 + float32Array.length * 2);
        const dv = new DataView(wavBuffer);

        const writeString = (dv, offset, string) => {
            for (let i = 0; i < string.length; i++) dv.setUint8(offset + i, string.charCodeAt(i));
        };

        writeString(dv, 0, 'RIFF');
        dv.setUint32(4, 36 + float32Array.length * 2, true);
        writeString(dv, 8, 'WAVE');
        writeString(dv, 12, 'fmt ');
        dv.setUint32(16, 16, true);
        dv.setUint16(20, 1, true); // PCM
        dv.setUint16(22, numChannels, true);
        dv.setUint32(24, sampleRate, true);
        dv.setUint32(28, byteRate, true);
        dv.setUint16(32, blockAlign, true);
        dv.setUint16(34, 16, true);
        writeString(dv, 36, 'data');
        dv.setUint32(40, float32Array.length * 2, true);

        let offset = 44;
        for (let i = 0; i < float32Array.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            dv.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([wavBuffer], { type: 'audio/wav' });
    };

    // --- New Profile Logic (Raw PCM) ---
    const startFixedRecording = async () => {
        try {
            initAudioContext();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    sampleRate: 16000
                }
            });
            streamRef.current = stream;

            const source = audioContextRef.current.createMediaStreamSource(stream);
            const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            recordingBufferRef.current = [];

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                recordingBufferRef.current.push(new Float32Array(inputData));
            };

            source.connect(processor);
            processor.connect(audioContextRef.current.destination);

            setIsRecording(true);
            setTimeLeft(5);

            const timer = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        stopRecording();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

        } catch (error) {
            console.error("Microphone error:", error);
            alert("Microphone access is required.");
        }
    };

    const stopRecording = () => {
        if (!processorRef.current) return;

        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        setIsRecording(false);

        if (recordingBufferRef.current.length > 0) {
            const totalLength = recordingBufferRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
            const mergedArray = new Float32Array(totalLength);
            let offset = 0;
            recordingBufferRef.current.forEach(chunk => {
                mergedArray.set(chunk, offset);
                offset += chunk.length;
            });

            recordingBufferRef.current = [];

            setTimeout(() => {
                const sampleRate = audioContextRef.current.sampleRate;
                const wavBlob = createWavBlob(mergedArray, sampleRate);
                const audioUrl = URL.createObjectURL(wavBlob);

                setRecordings(prev => [...prev, { pcmData: mergedArray, url: audioUrl }]);
            }, 10);
        }
    };

    const deleteRecording = (index) => {
        setRecordings(prev => {
            const newRecordings = [...prev];
            URL.revokeObjectURL(newRecordings[index].url);
            newRecordings.splice(index, 1);
            return newRecordings;
        });
    };

    const submitProfile = async () => {
        if (!profileName.trim()) return alert("Please enter a profile name.");
        if (recordings.length === 0) return alert("Please record at least one audio sample.");

        const formData = new FormData();
        formData.append("name", profileName);

        recordings.forEach((rec, index) => {
            const rawBlob = new Blob([rec.pcmData.buffer], { type: 'application/octet-stream' });
            formData.append("files", rawBlob, `sample_${index}.raw`);
        });

        try {
            const response = await fetch("http://localhost:8000/create_profile", {
                method: "POST",
                body: formData,
            });
            const result = await response.json();
            alert(result.message);

            if (response.ok) {
                setProfileName("");
                setRecordings([]);
                setView("home");
            }
        } catch (error) {
            console.error("Upload failed:", error);
            alert("Failed to save profile.");
        }
    };

    // --- Edit Profile Logic ---
    const fetchProfiles = async () => {
        try {
            const response = await fetch("http://localhost:8000/profiles");
            const data = await response.json();
            setSavedProfiles(data.profiles || []);
        } catch (error) {
            console.error("Failed to fetch profiles:", error);
        }
    };

    const handleDeleteProfile = async (name) => {
        if (!window.confirm(`Are you sure you want to delete profile '${name}'?`)) return;
        try {
            const response = await fetch(`http://localhost:8000/profile/${name}`, { method: "DELETE" });
            if (response.ok) setSavedProfiles(prev => prev.filter(p => p !== name));
        } catch (error) {
            console.error("Failed to delete profile:", error);
        }
    };

    // --- Listen Mode Logic (Raw PCM Streaming) ---
    const startListening = async () => {
        try {
            initAudioContext();
            wsRef.current = new WebSocket("ws://localhost:8000/ws/listen");

            wsRef.current.onopen = () => console.log("WebSocket connected");
            wsRef.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.speaker) setCurrentSpeaker(data.speaker);
            };

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    sampleRate: 16000
                }
            });
            streamRef.current = stream;

            analyserRef.current = audioContextRef.current.createAnalyser();
            const source = audioContextRef.current.createMediaStreamSource(stream);

            // 8192 frames at 16000Hz = 0.512 seconds per chunk
            // This ensures the backend evaluates the 3-second window approximately every 500ms
            const processor = audioContextRef.current.createScriptProcessor(8192, 1, 1);
            processorRef.current = processor;

            source.connect(analyserRef.current);
            analyserRef.current.connect(processor);
            processor.connect(audioContextRef.current.destination);
            analyserRef.current.fftSize = 256;

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(inputData.buffer);
                }
            };

            setIsListening(true);
            drawWaveform();

        } catch (error) {
            console.error("Error starting listen mode:", error);
            alert("Could not access microphone.");
        }
    };

    const stopListening = () => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current.onaudioprocess = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (wsRef.current) wsRef.current.close();
        if (animationRef.current) cancelAnimationFrame(animationRef.current);

        setIsListening(false);
        setCurrentSpeaker("Nobody");
    };

    const drawWaveform = () => {
        if (!canvasRef.current || !analyserRef.current) return;
        const canvas = canvasRef.current;
        const canvasCtx = canvas.getContext('2d');
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);
            analyserRef.current.getByteTimeDomainData(dataArray);

            // Panel backdrop
            canvasCtx.fillStyle = '#12151b';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

            // Technical grid backdrop
            canvasCtx.strokeStyle = 'rgba(137, 145, 160, 0.12)';
            canvasCtx.lineWidth = 1;
            const cols = 12, rows = 4;
            for (let c = 1; c < cols; c++) {
                const x = (canvas.width / cols) * c;
                canvasCtx.beginPath();
                canvasCtx.moveTo(x, 0);
                canvasCtx.lineTo(x, canvas.height);
                canvasCtx.stroke();
            }
            for (let r = 1; r < rows; r++) {
                const y = (canvas.height / rows) * r;
                canvasCtx.beginPath();
                canvasCtx.moveTo(0, y);
                canvasCtx.lineTo(canvas.width, y);
                canvasCtx.stroke();
            }
            canvasCtx.strokeStyle = 'rgba(137, 145, 160, 0.22)';
            canvasCtx.beginPath();
            canvasCtx.moveTo(0, canvas.height / 2);
            canvasCtx.lineTo(canvas.width, canvas.height / 2);
            canvasCtx.stroke();

            // Signal trace with a soft phosphor glow
            canvasCtx.lineWidth = 2.5;
            canvasCtx.strokeStyle = '#7fe7c4';
            canvasCtx.shadowColor = 'rgba(127, 231, 196, 0.65)';
            canvasCtx.shadowBlur = 8;
            canvasCtx.beginPath();

            const sliceWidth = canvas.width * 1.0 / bufferLength;
            let x = 0;
            const zoomFactor = 4.0;

            for (let i = 0; i < bufferLength; i++) {
                let amplitude = (dataArray[i] - 128.0) / 128.0;
                amplitude *= zoomFactor;
                amplitude = Math.max(-1.0, Math.min(1.0, amplitude));
                const y = (amplitude + 1.0) * (canvas.height / 2);

                if (i === 0) canvasCtx.moveTo(x, y);
                else canvasCtx.lineTo(x, y);

                x += sliceWidth;
            }

            canvasCtx.lineTo(canvas.width, canvas.height / 2);
            canvasCtx.stroke();
            canvasCtx.shadowBlur = 0;
        };
        draw();
    };

    // --- Shared bits ---
    const NavItem = ({ id, label, icon: Icon }) => (
        <button
            className={`nav-item ${view === id ? 'nav-item-active' : ''}`}
            onClick={() => setView(id)}
        >
            <Icon size={17} strokeWidth={2} />
            <span>{label}</span>
        </button>
    );

    // --- Views ---
    const renderHome = () => (
        <div className="view view-home">
            <div className="home-hero">
                <div style={{ textAlign: "left" }}>
                    <h1 style={{ color: "white" }}>Voice Verification Console</h1>
                    <p className="hero-sub">Register profiles, manage your known voice set, and recognize who's speaking in real time.</p>
                </div>
                <div className="hero-mark" aria-hidden="true">
                    {[0.3, 0.6, 0.9, 0.5, 0.75, 0.4, 0.85, 0.55].map((h, i) => (
                        <span key={i} style={{ height: `${h * 100}%` }} />
                    ))}
                </div>
            </div>

            <div className="module-grid">
                <button className="module-card" onClick={() => setView("new")}>
                    <UserPlus size={30} strokeWidth={1.8} />
                    <h2 style={{ color: "white", marginTop: "10px", marginBottom: "10px" }}>New Profile</h2>
                    <p style={{ fontSize: "15px" }}>Record some voice samples and create a new recognizable identity.</p>
                    <span className="module-arrow">→</span>
                </button>
                <button className="module-card" onClick={() => setView("edit")}>
                    <Users size={30} strokeWidth={1.8} />
                    <h2 style={{ color: "white", marginTop: "10px", marginBottom: "10px" }}>Saved Profiles</h2>
                    <p style={{ fontSize: "15px" }}>View and delete identities already registered in the system.</p>
                    <span className="module-arrow">→</span>
                </button>
                <button className="module-card module-card-primary" onClick={() => setView("listen")}>
                    <Radio size={30} strokeWidth={1.8} />
                    <h2 style={{ color: "white", marginTop: "10px", marginBottom: "10px" }}>Real-time Analysis</h2>
                    <p style={{ fontSize: "15px" }}>Listen to the microphone and identify the speaker in real time.</p>
                    <span className="module-arrow">→</span>
                </button>
            </div>
        </div>
    );

    const renderNewProfile = () => (
        <div className="view">
            <div className="view-header">
                <button className="icon-btn" onClick={() => setView("home")} aria-label="Indietro">
                    <ArrowLeft size={18} />
                </button>
                <div style={{ textAlign: "left" }}>
                    <h2 style={{ color: "white" }}>New Profile</h2>
                    <p className="view-sub">Record at least one 5-second sample of clear voice.</p>
                </div>
            </div>

            <div className="new-profile-grid">
                <div className="panel record-panel">
                    <label className="field-label" htmlFor="profile-name">Profile Name</label>
                    <input
                        id="profile-name"
                        type="text"
                        placeholder="e.g., Charles Ward"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="text-input"
                    />

                    <div className="record-control">
                        <div
                            className="record-ring"
                            style={{
                                background: isRecording
                                    ? `conic-gradient(var(--accent-record) ${((5 - timeLeft) / 5) * 360}deg, var(--border-bright) 0deg)`
                                    : 'var(--border-bright)'
                            }}
                        >
                            <button
                                className={`record-btn ${isRecording ? 'record-btn-active' : ''}`}
                                onClick={startFixedRecording}
                                disabled={isRecording}
                            >
                                {isRecording ? (
                                    <span className="record-timer">{timeLeft}</span>
                                ) : (
                                    <Mic size={26} strokeWidth={1.8} />
                                )}
                            </button>
                        </div>
                        <p className="record-caption">
                            {isRecording ? "Recording in progress…" : "Start a 5-second recording"}
                        </p>
                    </div>
                </div>

                <div className="panel samples-panel">
                    <div className="panel-header-row">
                        <span className="field-label">Current Samples</span>
                        <span className="count-pill">{recordings.length}</span>
                    </div>

                    {recordings.length === 0 ? (
                        <div className="empty-state">
                            <p>No samples yet. Registered samples will appear here.</p>
                        </div>
                    ) : (
                        <div className="sample-list">
                            {recordings.map((rec, index) => {
                                const peaks = getPeaks(rec.pcmData);
                                return (
                                    <div key={index} className="sample-row">
                                        <span className="sample-index">{String(index + 1).padStart(2, '0')}</span>
                                        <div className="sample-waveform" aria-hidden="true">
                                            {peaks.map((p, i) => (
                                                <span key={i} style={{ height: `${p * 100}%` }} />
                                            ))}
                                        </div>
                                        <audio src={rec.url} controls className="sample-audio" />
                                        <button className="icon-btn icon-btn-danger" onClick={() => deleteRecording(index)} aria-label="Elimina campione">
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <button
                        className="primary-btn"
                        onClick={submitProfile}
                        disabled={recordings.length === 0 || !profileName || isRecording}
                    >
                        Save Profile
                    </button>
                </div>
            </div>
        </div>
    );

    const renderEditProfile = () => (
        <div className="view">
            <div className="view-header">
                <button className="icon-btn" onClick={() => setView("home")} aria-label="Indietro">
                    <ArrowLeft size={18} />
                </button>
                <div style={{ textAlign: "left" }}>
                    <h2 style={{ color: "white" }}>Saved Profiles</h2>
                    <p className="view-sub">{savedProfiles.length} identities registered in the system.</p>
                </div>
            </div>

            {savedProfiles.length === 0 ? (
                <div className="empty-state empty-state-wide">
                    <p>No profiles found. Create a new profile to get started.</p>
                </div>
            ) : (
                <div className="profile-grid">
                    {savedProfiles.map((name) => (
                        <div key={name} className="profile-card">
                            <div className="profile-avatar">{name.trim().charAt(0).toUpperCase() || "?"}</div>
                            <span className="profile-name">{name}</span>
                            <button
                                className="icon-btn icon-btn-danger profile-delete"
                                onClick={() => handleDeleteProfile(name)}
                                title="Delete Profile"
                                aria-label={`Delete ${name}`}
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderListen = () => (
        <div className="view">
            <div className="view-header">
                <button className="icon-btn" onClick={() => { stopListening(); setView("home"); }} aria-label="Indietro">
                    <ArrowLeft size={18} />
                </button>
                <div style={{ textAlign: "left" }}>
                    <h2 style={{ color: "white" }}>Live Analysis</h2>
                    <p className="view-sub">Real-time speaker identification from the microphone.</p>
                </div>
            </div>

            <div className={`listen-stage panel ${isListening ? 'listen-stage-active' : ''}`}>
                <div className="speaker-readout">
                    <span className="speaker-label">Speaker detected:</span>
                    <span className={`speaker-name ${currentSpeaker !== "Nobody" ? 'speaker-name-active' : ''}`}>
                        {currentSpeaker}
                    </span>
                </div>

                <div className="scope-frame">
                    <canvas ref={canvasRef} width="960" height="220" className="scope-canvas" style={{ display: isListening ? "block" : "none" }} />
                    {!isListening && (
                        <div className="scope-placeholder">
                            <p>Click "Start Live Analysis" to begin.</p>
                        </div>
                    )}
                </div>

                <button
                    className={`primary-btn wide-btn ${isListening ? 'danger-btn' : ''}`}
                    onClick={isListening ? stopListening : startListening}
                >
                    {isListening ? "Stop Analysis" : "Start Live Analysis"}
                </button>
            </div>
        </div>
    );

    return (
        <div className="app-shell">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap');

                html, body, #root {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    background: #0b0d11;
                }

                .app-shell {
                    --bg-void: #0b0d11;
                    --bg-panel: #14171d;
                    --bg-raised: #1b1f26;
                    --border: #262a32;
                    --border-bright: #363c47;
                    --text-primary: #ecedf1;
                    --text-secondary: #8991a0;
                    --text-tertiary: #565c68;
                    --accent-signal: #7fe7c4;
                    --accent-signal-dim: rgba(127, 231, 196, 0.12);
                    --accent-record: #f2a65a;
                    --accent-record-dim: rgba(242, 166, 90, 0.14);
                    --accent-danger: #e8654f;
                    --accent-danger-dim: rgba(232, 101, 79, 0.12);
                    --font-display: 'Space Grotesk', sans-serif;
                    --font-mono: 'IBM Plex Mono', monospace;

                    display: flex;
                    position: fixed;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    min-height: 640px;
                    background: var(--bg-void);
                    color: var(--text-primary);
                    font-family: var(--font-display);
                    overflow: hidden;
                    box-sizing: border-box;
                }
                .app-shell *, .app-shell *::before, .app-shell *::after { box-sizing: border-box; }

                .app-shell button { font-family: inherit; }
                .app-shell button:focus-visible,
                .app-shell input:focus-visible {
                    outline: 2px solid var(--accent-signal);
                    outline-offset: 2px;
                }

                @media (prefers-reduced-motion: reduce) {
                    .app-shell * { transition: none !important; animation: none !important; }
                }

                /* --- Sidebar --- */
                .sidebar {
                    width: 248px;
                    flex-shrink: 0;
                    background: var(--bg-panel);
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    padding: 28px 18px;
                }
                .brand {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 4px 10px 28px 10px;
                    border-bottom: 1px solid var(--border);
                    margin-bottom: 20px;
                }
                .brand-mark {
                    display: flex;
                    align-items: flex-end;
                    gap: 2px;
                    height: 30px;
                }
                .brand-mark span {
                    width: 6px;
                    border-radius: 1px;
                    background: var(--accent-signal);
                }
                .brand-text {
                    font-size: 20.5px;
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    line-height: 1.25;
                }
                .brand-text small {
                    display: block;
                    font-family: var(--font-mono);
                    font-size: 14.5px;
                    font-weight: 400;
                    color: var(--text-tertiary);
                    margin-top: 1px;
                }

                .nav-group { display: flex; flex-direction: column; gap: 3px; }
                .nav-item {
                    display: flex;
                    align-items: center;
                    gap: 11px;
                    padding: 10px 12px;
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 8px;
                    color: var(--text-secondary);
                    font-size: 18px;
                    font-weight: 500;
                    cursor: pointer;
                    text-align: left;
                    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
                }
                .nav-item:hover { background: var(--bg-raised); color: var(--text-primary); }
                .nav-item-active {
                    background: var(--accent-signal-dim);
                    border-color: rgba(127, 231, 196, 0.25);
                    color: var(--accent-signal);
                }

                .sidebar-footer {
                    margin-top: auto;
                    padding-top: 16px;
                    border-top: 1px solid var(--border);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .status-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: var(--accent-signal);
                    flex-shrink: 0;
                }
                .sidebar-footer span {
                    font-family: var(--font-mono);
                    font-size: 11px;
                    color: var(--text-tertiary);
                }

                /* --- Main --- */
                .main {
                    flex: 1;
                    overflow-y: auto;
                    padding: 52px 64px;
                }
                .view { max-width: 1180px; }

                h1 {
                    font-size: 34px;
                    font-weight: 600;
                    letter-spacing: -0.01em;
                    margin: 0 0 10px 0;
                }
                h2 { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.005em; }
                h3 { font-size: 16.5px; font-weight: 600; margin: 14px 0 6px 0; }
                p { margin: 0; color: var(--text-secondary); line-height: 1.55; font-size: 14px; }

                .hero-sub { max-width: 800px; font-size: 15px; }

                .home-hero {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 40px;
                    padding-bottom: 18px;
                    border-bottom: 1px solid var(--border);
                    margin-bottom: 30px;
                }
                .hero-mark {
                    display: flex;
                    align-items: flex-end;
                    gap: 5px;
                    height: 84px;
                    flex-shrink: 0;
                    padding: 0 8px;
                }
                .hero-mark span {
                    width: 7px;
                    border-radius: 2px;
                    background: linear-gradient(to top, var(--accent-signal), rgba(127,231,196,0.25));
                }

                .module-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 16px;
                }
                .module-card {
                    position: relative;
                    text-align: left;
                    background: var(--bg-panel);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 24px 22px 22px 22px;
                    cursor: pointer;
                    color: var(--text-primary);
                    min-height: 172px;
                    display: flex;
                    flex-direction: column;
                    transition: border-color 0.12s ease, background 0.12s ease;
                }
                .module-card:hover { background: var(--bg-raised); border-color: var(--border-bright); }
                .module-card svg { color: var(--text-secondary); }
                .module-card p { margin-top: 4px; }
                .module-card-primary { border-color: rgba(127, 231, 196, 0.3); }
                .module-card-primary svg { color: var(--accent-signal); }
                .module-arrow {
                    margin-top: auto;
                    align-self: flex-end;
                    color: var(--text-tertiary);
                    font-size: 15px;
                }
                .module-card:hover .module-arrow { color: var(--text-primary); }

                .view-header {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    margin-bottom: 32px;
                }
                .view-sub { margin-top: 4px; font-size: 13.5px; }

                .icon-btn {
                    width: 36px;
                    height: 36px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: var(--bg-panel);
                    color: var(--text-secondary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    flex-shrink: 0;
                    transition: border-color 0.12s ease, color 0.12s ease;
                }
                .icon-btn:hover { border-color: var(--border-bright); color: var(--text-primary); }
                .icon-btn-danger:hover { border-color: rgba(232, 101, 79, 0.4); color: var(--accent-danger); background: var(--accent-danger-dim); }

                .panel {
                    background: var(--bg-panel);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 26px;
                }

                .field-label {
                    display: block;
                    font-family: var(--font-mono);
                    font-size: 14px;
                    color: var(--text-tertiary);
                    margin-bottom: 8px;
                }

                .text-input {
                    width: 100%;
                    padding: 11px 13px;
                    background: var(--bg-void);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    color: var(--text-primary);
                    font-size: 14px;
                    font-family: var(--font-display);
                }
                .text-input:focus { border-color: var(--accent-signal); }
                .text-input::placeholder { color: var(--text-tertiary); }

                .new-profile-grid {
                    display: grid;
                    grid-template-columns: 340px 1fr;
                    gap: 18px;
                    align-items: start;
                }

                .record-control {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 14px;
                    margin-top: 32px;
                    padding-top: 28px;
                    border-top: 1px solid var(--border);
                }
                .record-ring {
                    width: 108px;
                    height: 108px;
                    border-radius: 50%;
                    padding: 5px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s linear;
                }
                .record-btn {
                    width: 98px;
                    height: 98px;
                    border-radius: 50%;
                    border: none;
                    background: var(--bg-raised);
                    color: var(--text-primary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                }
                .record-btn:hover:not(:disabled) { background: var(--border-bright); }
                .record-btn-active { background: var(--bg-void); cursor: default; }
                .record-timer {
                    font-family: var(--font-mono);
                    font-size: 30px;
                    font-weight: 500;
                    color: var(--accent-record);
                }
                .record-caption { font-size: 13px; color: var(--text-secondary); }

                .panel-header-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                }
                .count-pill {
                    font-family: var(--font-mono);
                    font-size: 12px;
                    color: var(--text-secondary);
                    background: var(--bg-raised);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    padding: 2px 10px;
                }

                .empty-state {
                    padding: 30px 20px;
                    text-align: center;
                    border: 1px dashed var(--border);
                    border-radius: 10px;
                }
                .empty-state-wide { padding: 48px 20px; }

                .sample-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
                .sample-row {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    padding: 10px 14px;
                    background: var(--bg-raised);
                    border: 1px solid var(--border);
                    border-radius: 9px;
                }
                .sample-index {
                    font-family: var(--font-mono);
                    font-size: 11.5px;
                    color: var(--text-tertiary);
                    width: 18px;
                    flex-shrink: 0;
                }
                .sample-waveform {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    height: 28px;
                    min-width: 80px;
                }
                .sample-waveform span {
                    flex: 1;
                    background: var(--accent-signal);
                    opacity: 0.55;
                    border-radius: 1px;
                    min-height: 2px;
                }
                .sample-audio { height: 30px; width: 200px; flex-shrink: 0; }

                .primary-btn {
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    background: var(--accent-signal);
                    color: #0b1512;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    font-family: var(--font-display);
                }
                .primary-btn:hover:not(:disabled) { filter: brightness(1.08); }
                .primary-btn:disabled { background: var(--bg-raised); color: var(--text-tertiary); cursor: not-allowed; }
                .danger-btn { background: var(--accent-danger); color: #1a0b09; }
                .wide-btn { max-width: 340px; margin: 0 auto; }

                .profile-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                    gap: 12px;
                }
                .profile-card {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 16px;
                    background: var(--bg-panel);
                    border: 1px solid var(--border);
                    border-radius: 10px;
                    transition: border-color 0.12s ease;
                }
                .profile-card:hover { border-color: var(--border-bright); }
                .profile-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: var(--accent-signal-dim);
                    color: var(--accent-signal);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: var(--font-mono);
                    font-weight: 600;
                    font-size: 14px;
                    flex-shrink: 0;
                }
                .profile-name {
                    font-size: 14px;
                    font-weight: 500;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex: 1;
                }
                .profile-delete { margin-left: auto; }

                .listen-stage {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 24px;
                    padding: 40px;
                }
                .speaker-readout { display: flex; flex-direction: column; align-items: center; gap: 6px; }
                .speaker-label { font-family: var(--font-mono); font-size: 14px; color: var(--text-tertiary); }
                .speaker-name {
                    font-family: var(--font-mono);
                    font-size: 40px;
                    font-weight: 500;
                    color: var(--text-tertiary);
                    transition: color 0.2s ease;
                }
                .speaker-name-active { color: var(--accent-signal); }

                .scope-frame {
                    position: relative;
                    width: 100%;
                    border: 1px solid var(--border);
                    border-radius: 10px;
                    overflow: hidden;
                    background: #12151b;
                }
                .scope-canvas { width: 100%; height: 220px; display: block; }
                .scope-placeholder {
                    height: 220px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .scope-placeholder p { color: var(--text-tertiary); font-size: 13.5px; }
            `}</style>

            <aside className="sidebar">
                <div className="brand">
                    <div className="brand-mark" aria-hidden="true">
                        <span style={{ height: '60%' }} />
                        <span style={{ height: '100%' }} />
                        <span style={{ height: '75%' }} />
                    </div>
                    <div className="brand-text">
                        WhoSThis
                        <small>by Goultard</small>
                    </div>
                </div>
                <nav className="nav-group">
                    <NavItem id="home" label="Home" icon={Home} />
                    <NavItem id="new" label="New Profile" icon={UserPlus} />
                    <NavItem id="edit" label="Profiles" icon={Users} />
                    <NavItem id="listen" label="Live Listening" icon={Radio} />
                </nav>
                <div className="sidebar-footer">
                    <span className="status-dot" />
                    <span>engine ready</span>
                </div>
            </aside>

            <main className="main">
                {view === "new" && renderNewProfile()}
                {view === "edit" && renderEditProfile()}
                {view === "listen" && renderListen()}
                {view === "home" && renderHome()}
            </main>
        </div>
    );
}