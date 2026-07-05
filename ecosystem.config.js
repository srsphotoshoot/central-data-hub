module.exports = {
  apps: [
    {
      name: "cdh-backend",
      script: "./venv/bin/python",
      args: "main.py",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        KMP_DUPLICATE_LIB_OK: "TRUE"
      }
    },
    {
      name: "cdh-matcher-service",
      script: "./venv/bin/python",
      args: "matcher_server.py",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        KMP_DUPLICATE_LIB_OK: "TRUE"
      }
    },
    {
      name: "cdh-worker",
      script: "./venv/bin/python",
      args: "worker.py",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        KMP_DUPLICATE_LIB_OK: "TRUE"
      }
    },
    {
      name: "cdh-telegram-bot",
      script: "./venv/bin/python",
      args: "services/telegram_bot.py",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        KMP_DUPLICATE_LIB_OK: "TRUE"
      }
    },
    {
      name: "cdh-drive-sync",
      cwd: "/Users/romitaggarwal/Desktop/AI/central data hub",
      script: "./venv/bin/python",
      args: "services/drive_watcher.py",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        KMP_DUPLICATE_LIB_OK: "TRUE"
      }
    },
    {
      name: "cdh-frontend",
      script: "npm",
      args: "run dev",
      cwd: "/Users/romitaggarwal/Desktop/AI/central data hub/frontend",
      env: {
        NODE_ENV: "development"
      }
    },
    {
      name: "cdh-ai-downloader",
      script: "./venv/bin/python",
      args: "services/ai_image_downloader.py",
      cwd: "/Users/romitaggarwal/Desktop/AI/central data hub",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        KMP_DUPLICATE_LIB_OK: "TRUE"
      }
    }
  ]
};


