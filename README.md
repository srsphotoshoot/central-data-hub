# 🏰 Central Data Hub v2.0 (Local-First Edition)

Welcome to your **Central Data Hub (CDH)**. This system is designed to be your "Base of Operations" for all data coming from Decent ERP. It's currently optimized to run perfectly on your **Local Machine**.

---

## 🚀 Quick Start (Local)

### 1. One-Time Setup
Run the automated setup script to install all dependencies (Python & Node.js):
```bash
./setup.sh
```

### 2. Launch the Platform
Start both the Backend (FastAPI) and the Frontend (Vite Dashboard) with one command:
```bash
./run.sh
```
- **Dashboard**: [http://localhost:5173](http://localhost:5173)
- **API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🧠 Core Local Features

### 🛠️ Processing Rules
Define how your data is transformed.
- Go to the **Processing Rules** tab in the dashboard.
- Map fields from Decent ERP (e.g., `total`) to your Hub's preferred fields (e.g., `price`).
- Data is automatically categorized as it arrives!

### 📡 Outbound Dispatcher
Test your Hub's ability to "Push" data to other local apps.
1. Run the test mock app: `python test_webhook.py` (Starts on port 9000).
2. On your Dashboard (**Integrations** tab), create a key with Callback URL: `http://localhost:9000/webhook`.
3. Whenever data is processed, you'll see a notification pop up in your terminal!

---

## 📂 Project Structure
- `main.py`: The FastAPI backend engine.
- `database.py`: Local SQLite database & models.
- `processing.py`: The Rule-based transformation engine.
- `dispatcher.py`: The Outbound Webhook service.
- `frontend/`: The "Midnight Glass" React dashboard.

---

## ☁️ Future Deployment
When you are ready to move to a **Virtual Server**, the Hub is already **Cloud Ready**:
- Use `docker-compose up -d` to deploy via Docker.
- Use `python scripts/migrate_to_pg.py` to move your local data to a cloud PostgreSQL database.

> [!TIP]
> **Data Security**: Your API keys are strictly local for now. When you move to a virtual deployment, ensure you change your `.env` secrets!
