#!/bin/bash

# Central Data Hub - Unified Local Runner
# Starts Backend, Frontend, and The Automation Worker

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Central Data Hub Platform...${NC}"

# 1. Dependency Checks
if [ ! -d "venv" ]; then
    echo -e "${RED}❌ Virtual environment missing! Please run './setup.sh' first.${NC}"
    exit 1
fi

cd frontend || exit 1
if [ ! -d "node_modules" ]; then
    echo -e "${RED}❌ Frontend 'node_modules' missing! Please run './setup.sh' first.${NC}"
    exit 1
fi
cd ..

# Function to handle cleanup on exit
cleanup() {
    echo -e "\n${BLUE}🛑 Shutting down Hub Services...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    kill $WORKER_PID 2>/dev/null
    exit
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

# 2. Start Backend
echo -e "${GREEN}📡 Starting Backend Cluster (FastAPI)...${NC}"
source venv/bin/activate
python3 main.py &
BACKEND_PID=$!

# 3. Start Frontend
echo -e "${GREEN}💻 Starting Dashboard Interface (Vite)...${NC}"
cd frontend || exit 1
npm run dev &
FRONTEND_PID=$!
cd ..

# 4. Start Automation Pulse (Worker)
echo -e "${GREEN}💓 Starting Automation Pulse (Worker)...${NC}"
source venv/bin/activate
python3 worker.py &
WORKER_PID=$!

# 5. Final Status
echo -e "\n${GREEN}✨ Central Data Hub is now ONLINE (FULL AUTO)!${NC}"
echo -e "--------------------------------------------------"
echo -e "  Management Dashboard: http://localhost:5173"
echo -e "  API Infrastructure:   http://localhost:8000"
echo -e "  Automation Pulse:     Active (8s Interval)"
echo -e "--------------------------------------------------"
echo -e "Press Ctrl+C to stop all services."

wait
