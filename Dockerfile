# --- Stage 1: Build Frontend ---
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Final Backend Container ---
FROM python:3.10-slim
WORKDIR /app

# Install system dependencies (postgres client)
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install gunicorn uvicorn

# Copy backend code
COPY . .

# Copy built frontend to backend's static directory if needed, 
# but we'll serve it separately or via FastAPI if we want single-container.
# For simplicity, we'll keep it as a separate volume in compose or serve via Nginx.
# Let's copy the 'dist' to a place where FastAPI can find it if we want.
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose backend port
EXPOSE 8000

# Default command: Start with Gunicorn/Uvicorn for production
CMD ["gunicorn", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "main:app", "--bind", "0.0.0.0:8000"]
