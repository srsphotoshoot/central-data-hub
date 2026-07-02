#!/bin/bash

# Central Data Hub - Local Setup Automation
# Automates Virtual Environment and Node Module installation

BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔨 Starting Local Environment Setup...${NC}"

# 1. Setup Python Virtual Environment
echo -e "${GREEN}📦 Setting up Python Virtual Environment...${NC}"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 2. Setup Node Modules for Frontend
echo -e "${GREEN}💻 Setting up Frontend Dependencies (NPM)...${NC}"
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
else
    echo -e "${BLUE}ℹ️  node_modules already exists, skipping npm install.${NC}"
fi
cd ..

# 3. Initialize Database (Optional, main.py does this too)
echo -e "${GREEN}🗄️  Initializing SQLite Database...${NC}"
python3 -c "from database import init_db; init_db()"

echo -e "\n${GREEN}✨ Setup Complete!${NC}"
echo -e "${BLUE}👉 Run './run.sh' to start the system.${NC}"
