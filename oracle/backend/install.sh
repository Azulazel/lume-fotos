#!/bin/bash
set -euo pipefail
id lume >/dev/null 2>&1 || useradd --system --home /var/lib/lume --shell /usr/sbin/nologin lume
install -d -m 755 /opt/lume
cp -a /home/ubuntu/lume-oracle/. /opt/lume/
chmod -R a+rX /opt/lume
install -d -o lume -g lume -m 700 /var/lib/lume
python3 -m venv /opt/lume/venv
/opt/lume/venv/bin/pip install --disable-pip-version-check -r /opt/lume/backend/requirements.txt
if [ ! -f /etc/lume.env ]; then
 umask 077
 printf 'LUME_SECRET=%s\n' "$(python3 -c 'import secrets; print(secrets.token_hex(32))')" > /etc/lume.env
 printf '%s\n' 'PUBLIC_URL=https://lume.163.176.48.125.sslip.io' 'LEGACY_URL=https://noifossknvzoafqldpat.supabase.co' 'LEGACY_ANON=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vaWZvc3NrbnZ6b2FmcWxkcGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NTE1NTcsImV4cCI6MjEwOTUyNzU1N30.yOnAdhbKG7As-4dEEwLXmQ8zZ__FL5GU94cFlWsL_YQ' >> /etc/lume.env
fi
cp /opt/lume/backend/lume.service /etc/systemd/system/lume.service
cp /opt/lume/backend/nginx.conf /etc/nginx/sites-available/lume
ln -sf /etc/nginx/sites-available/lume /etc/nginx/sites-enabled/lume
iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 4 -p tcp --dport 80 -j ACCEPT
iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 4 -p tcp --dport 443 -j ACCEPT
iptables-save > /etc/iptables/rules.v4
systemctl daemon-reload
systemctl enable --now lume
nginx -t
systemctl reload nginx
