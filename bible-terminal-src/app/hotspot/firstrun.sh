#!/bin/bash
# Bible Terminal first-boot setup for a Raspberry Pi (tested design: Pi Zero 2 W, Raspberry Pi OS Lite).
# Runs once, as root, from the boot partition, before the system finishes starting. It:
#   1. removes its own boot hook (so a failure can never cause a boot loop)
#   2. copies the reader and a tiny web server onto the Pi
#   3. makes the Pi's Wi-Fi an open (or password) hotspot with a "sign in" page that opens the reader
# Everything it does is logged to firstrun.log next to this file, on the SD card's boot partition.

SRC=/boot/firmware/bible-terminal
LOG="$SRC/firstrun.log"
exec >>"$LOG" 2>&1
echo "== Bible Terminal first run: $(date 2>/dev/null)"

# 1. never run twice, never loop
sed -i -E 's/ ?systemd\.run=[^ ]*//; s/ ?systemd\.run_success_action=[^ ]*//; s/ ?systemd\.unit=[^ ]*//' /boot/firmware/cmdline.txt
echo "boot hook removed"

# shellcheck disable=SC1091
. "$SRC/config.env"
IP="${BT_IP:-10.42.0.1}"

# 2. reader + web server
mkdir -p /opt/bible-terminal
rm -rf /opt/bible-terminal/www
cp -r "$SRC/www" /opt/bible-terminal/www
cp "$SRC/serve.py" /opt/bible-terminal/serve.py
chmod 755 /opt/bible-terminal/serve.py
echo "files copied"

cat > /etc/systemd/system/bible-terminal.service <<EOF
[Unit]
Description=Bible Terminal offline reader
After=network.target

[Service]
Environment=BT_IP=$IP
ExecStart=/usr/bin/python3 /opt/bible-terminal/serve.py
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
mkdir -p /etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/bible-terminal.service /etc/systemd/system/multi-user.target.wants/bible-terminal.service
echo "service installed"

# 3. Wi-Fi hotspot through NetworkManager (the default on current Raspberry Pi OS)
mkdir -p /etc/NetworkManager/system-connections /etc/NetworkManager/dnsmasq-shared.d
NMFILE=/etc/NetworkManager/system-connections/bible-terminal.nmconnection
{
  echo "[connection]"
  echo "id=Bible Terminal"
  echo "uuid=$(cat /proc/sys/kernel/random/uuid)"
  echo "type=wifi"
  echo "interface-name=wlan0"
  echo "autoconnect=true"
  echo "autoconnect-priority=100"
  echo
  echo "[wifi]"
  echo "mode=ap"
  echo "ssid=$BT_SSID"
  echo "band=bg"
  echo "channel=6"
  if [ -n "$BT_PSK" ]; then
    echo
    echo "[wifi-security]"
    echo "key-mgmt=wpa-psk"
    echo "psk=$BT_PSK"
  fi
  echo
  echo "[ipv4]"
  echo "method=shared"
  echo "address1=$IP/24"
  echo
  echo "[ipv6]"
  echo "method=ignore"
} > "$NMFILE"
chmod 600 "$NMFILE"
# answer every name with the Pi's own address, so any web address opens the reader
echo "address=/#/$IP" > /etc/NetworkManager/dnsmasq-shared.d/bible-terminal.conf
echo "hotspot profile written"

# Wi-Fi is switched off until a country is set on a fresh Raspberry Pi OS; switch it on
rfkill unblock wifi 2>/dev/null
for f in /var/lib/systemd/rfkill/*:wlan; do [ -e "$f" ] && echo 0 > "$f"; done
echo "wifi unblocked"

# 4. make sure the radio is on and the hotspot is up on every boot, and leave a Wi-Fi report on the card
cat > /opt/bible-terminal/wifi-up.sh <<'EOS'
#!/bin/sh
. /boot/firmware/bible-terminal/config.env
rfkill unblock all 2>/dev/null
command -v iw >/dev/null 2>&1 && iw reg set "${BT_COUNTRY:-US}" 2>/dev/null
nmcli radio wifi on
i=0
while [ $i -lt 20 ]; do nmcli -t -f DEVICE device 2>/dev/null | grep -q '^wlan0$' && break; i=$((i+1)); sleep 2; done
nmcli connection reload
nmcli connection up "Bible Terminal"
exit 0
EOS
cat > /opt/bible-terminal/diag.sh <<'EOS'
#!/bin/sh
sleep 60
{
  echo "== wifi report $(date 2>/dev/null)"
  echo "--- rfkill"; rfkill list 2>&1
  echo "--- nmcli radio"; nmcli radio 2>&1
  echo "--- nmcli device"; nmcli device 2>&1
  echo "--- nmcli connection"; nmcli connection show 2>&1
  echo "--- ip addr"; ip addr 2>&1
  echo "--- iw reg"; iw reg get 2>&1
  echo "--- bible-terminal service"; systemctl is-active bible-terminal 2>&1
  echo "--- wifi-up service"; systemctl status bible-terminal-wifi --no-pager 2>&1 | tail -15
  echo "--- NetworkManager log"; journalctl -u NetworkManager -b --no-pager 2>&1 | tail -60
  echo "--- kernel wifi lines"; dmesg 2>&1 | grep -iE 'brcm|wlan|firmware|cfg80211|rfkill' | tail -30
} > /boot/firmware/bible-terminal/wifi-diag.log 2>&1
exit 0
EOS
chmod 755 /opt/bible-terminal/wifi-up.sh /opt/bible-terminal/diag.sh

cat > /etc/systemd/system/bible-terminal-wifi.service <<'EOS'
[Unit]
Description=Bible Terminal: switch Wi-Fi on and start the hotspot
After=NetworkManager.service
Wants=NetworkManager.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/opt/bible-terminal/wifi-up.sh
[Install]
WantedBy=multi-user.target
EOS
cat > /etc/systemd/system/bible-terminal-diag.service <<'EOS'
[Unit]
Description=Bible Terminal: write a Wi-Fi report to the boot partition
After=bible-terminal-wifi.service
[Service]
Type=oneshot
ExecStart=/opt/bible-terminal/diag.sh
[Install]
WantedBy=multi-user.target
EOS
mkdir -p /etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/bible-terminal-wifi.service /etc/systemd/system/multi-user.target.wants/bible-terminal-wifi.service
ln -sf /etc/systemd/system/bible-terminal-diag.service /etc/systemd/system/multi-user.target.wants/bible-terminal-diag.service
echo "services installed"

# 5. keep logs in memory only, so the card holds no record of who connected
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\n' > /etc/systemd/journald.conf.d/bible-terminal.conf
rm -rf /var/log/journal
echo "logs set to memory only"

touch "$SRC/DONE"
echo "== done"
exit 0
