# Handoff: 500 error on cxquiz.tech

Temporary file. Delete once the site is up.

## Symptom

`https://cxquiz.tech` returns **500 Internal Server Error** in a browser.

## Already established, do not re-verify

The application is healthy. Confirmed directly on the VPS, bypassing nginx:

- `curl -i http://127.0.0.1:3000/api/health` → **200**, `{"ok":true,"games":0,"players":0}`, uptime about 72 minutes
- `curl -i http://127.0.0.1:3000/` → **200**, full player page HTML, correct headers
- `/var/log/nginx/floor-quiz.error.log` → **empty**
- Node, SQLite, Express and the game code are all fine. The problem is not in the app.

One red herring already resolved: `pm2 status` run as **root** printed an empty table, because
root has its own PM2 daemon. The app runs under the `deploy` user. Use
`sudo -u deploy -i pm2 status`.

## Leading hypothesis

**Requests are never reaching this VPS.** A healthy app plus an empty nginx error log points
away from the server entirely. Hostinger auto-creates DNS records and a hosting entry when a
domain is registered, pointing at their shared infrastructure rather than the VPS. Their shared
server then returns a 500 because no site is provisioned there.

A weaker second possibility: requests arrive but hit a different nginx server block, for
example a leftover default site or a control panel listening on port 80.

## Checks to run first

```bash
dig +short cxquiz.tech                              # where the domain points
curl -4 -s https://api.ipify.org; echo              # where this server actually is
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: cxquiz.tech" http://127.0.0.1/
sudo nginx -T | grep -n "server_name\|listen " | head -40
sudo ss -ltnp | grep ':80\|:443'
```

Interpretation:

- **First two IPs differ** → confirmed DNS. Fix is in Hostinger hPanel, nothing to change on the
  server. *Edit* the existing `A` record for `@` rather than adding a second one, since two `A`
  records round-robin and send half the players to a parking page. Detach any website or hosting
  entry attached to the domain, since that is usually what is hijacking the records. Set `www`
  as an `A` record to the same IP and remove any `CNAME` on it.
- **IPs match but the third command is not 200** → nginx is misrouting. Look for a competing
  server block or a stray `default_server`.
- **IPs match and the third command is 200** → the edge is fine and something between the
  client and the server is interfering. Check whether Hostinger has a proxy or firewall in front.

## Constraints

- Diagnose with `curl`, not a browser. HSTS with a one year max-age means a browser that has
  seen this domain over HTTPS will refuse plain HTTP and mislead you.
- Do not run `certbot` yet. TLS was already issued, or was skipped because DNS was not ready.
  Check `sudo certbot certificates` before assuming either way. Repeated failed issuance hits
  Let's Encrypt rate limits.
- Report findings and propose the fix before changing anything.
