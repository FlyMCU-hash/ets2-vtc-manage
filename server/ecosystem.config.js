module.exports = {
  apps: [{
    name: "peak",
    script: "server.js",
    cwd: "/www/wwwroot/peak",
    interpreter: "/www/server/nodejs/v20.19.0/bin/node",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "1024M",
    env: { NODE_ENV: "production" },
  }],
};
