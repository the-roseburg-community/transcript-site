Scripts

After adding scripts:
 - chmod +x the script
 - Add nginx location
 - Add systemd .service file:

 ```
 # /etc/systemd/system/rr-law1-aggregate.service
 [Unit]
Description=Roseburg Receiver - Law1 last24h transcript aggregator

[Service]
Type=oneshot
Environment=TZ=America/Los_Angeles
ExecStart=/opt/transcript/scripts/aggregate_law1_last24h.py
```

 - Add the timer:
 ```
 # /etc/systemd/system/rr-law1-aggregate.timer
[Unit]
Description=Run RR Law1 aggregator every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Persistent=true

[Install]
WantedBy=timers.target

```

```
sudo systemctl daemon-reload
sudo systemctl enable --now rr-law1-aggregate.timer
sudo systemctl status rr-law1-aggregate.timer
```