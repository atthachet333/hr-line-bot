module.exports = {
  apps: [
    {
      name: "hr-line-bot",
      cwd: "C:\\Users\\Administrator\\Desktop\\project\\hr-line-bot",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3333",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        PORT: "3333"
      }
    }
  ]
};