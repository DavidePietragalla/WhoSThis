# 📞 WhoSThis — Real-Time Speaker Identification System
This project is a lightweight and real-time speaker identification system that is able to recognize voices from short audio samples using a compact deep learning model. Built with a FastAPI backend and a React frontend, it lets users create speaker profiles, compare live audio against stored identities, and perform real-time voice matching with low-latency inference.

## 🚀 Key Features
- **Real-time speaker identification** from live audio streams using a trained deep-learning voice embedding model.
- **Speaker profile creation and management**, allowing users to register voices and compare live recordings against saved identities.
- **Fast API-based backend** for audio processing, embedding extraction, profile storage, and WebSocket-based live recognition.
- **React frontend** for a simple, interactive user experience with profile creation, listing, and deletion.
- **Lightweight, efficient model design** that balances accuracy and inference speed for practical deployments.
- **Flexible architecture** that supports future extensions such as additional models, improved threshold tuning, or multi-user enrollment workflows.

## 📸 Working


https://github.com/user-attachments/assets/67bd497a-6c44-4c24-9501-ccc81ad9c6ff


<img width="1436" alt="Screenshot 2025-06-24 at 6 08 38 PM" src="https://github.com/user-attachments/assets/665aade1-33a9-4554-b064-3b6df7b55005" />
<img width="1436" alt="Screenshot 2025-06-24 at 6 08 38 PM" src="https://github.com/user-attachments/assets/3835bff7-2cc4-44f5-bb3e-0004e899d2dc" />

## 📦 Installation
To set up the project, follow these steps:
1. **Prerequisites**: Make sure you have Python 3.10+ and Node.js 18+ installed.
2. **Clone the Repository**: Run `git clone https://github.com/DavidePietragalla/WhoSThis` to download the project.
3. **Install the Python Dependencies**: Run `pip install fastapi uvicorn torch torchaudio speechbrain`.
4. **Install the Frontend Dependencies**: Move to the frontend folder and run `npm install`.
6. **Start the Application**: You should be able to run both backend and frontend with `npm run dev:all`

## 💻 Usage
1. **Start the Backend**: Run `node server.js` to start the Express server.
2. **Start the Frontend**: Run `npm run dev` to start the Next.js development server.
3. **Interact with the Application**: Open your web browser and navigate to `http://localhost:3000` to use the application.
4. Testing sync

## 📂 Project Structure
```markdown
project/
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── ...
│   ├── lib/
│   │   ├── config.ts
│   │   ├── utils.ts
│   │   └── ...
│   ├── next.config.ts
│   ├── package.json
│   └── ...
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── readme.ts
│   │   │   └── ...
│   │   ├── utils/
│   │   │   ├── make-dir.ts
│   │   │   ├── clone-repo.ts
│   │   │   └── ...
│   │   ├── python/
│   │   │   ├── agents.py
│   │   │   ├── llm_fallback.py
│   │   │   ├── prompts.py
│   │   │   └── ...
│   │   └── ...
│   ├── package.json
│   └── ...
├── .env
├── README.md
└── ...
```
## 🤝 Contributing
Contributions are what make the open-source community such an amazing place to learn and create. Any contributions you make are **greatly appreciated**.
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request


## 📬 Contact
[@LakshitAgarwal](https://x.com/lakshitagarwal7?s=21) - [lakshit7811@gmail.com](mailto:lakshit7811@gmail.com)

## Thanks
This project was made possible thanks to the contributions of many individuals and the support of our community. 
This is written by [readme.ai](https://readme-generator-phi.vercel.app/) for better documentation.

