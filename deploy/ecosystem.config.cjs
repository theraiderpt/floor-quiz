/* PM2 process definition.
   Start:   pm2 start deploy/ecosystem.config.cjs
   Persist: pm2 save && pm2 startup   (run the command it prints, with sudo)
   Logs:    pm2 logs floor-quiz
*/
module.exports = {
  apps: [
    {
      name: "floor-quiz",
      script: "server/index.js",
      cwd: "/var/www/floor-quiz",

      /* Single instance on purpose. Game state lives in memory, so a second
         worker would own a different set of games and half the room would
         land on a server that has never heard of their PIN. If you ever need
         to scale past one process, add the socket.io Redis adapter and move
         game state out of memory first. */
      instances: 1,
      exec_mode: "fork",

      env: { NODE_ENV: "production" },

      max_memory_restart: "500M",
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 20,

      out_file: "/var/log/floor-quiz/out.log",
      error_file: "/var/log/floor-quiz/error.log",
      merge_logs: true,
      time: true,

      /* Give in-flight games a moment to flush results to sqlite on restart. */
      kill_timeout: 8000,
      wait_ready: false
    }
  ]
};
