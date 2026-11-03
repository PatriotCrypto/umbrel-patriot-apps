# Cold Front

Local thermostat control for Umbrel. Built for the Honeywell T6 Pro Z-Wave (TH6320ZW2003) and a Z-Wave 800-series USB stick (Zooz ZST39 LR).

- Weekly schedule, holds, away mode, safety limits
- Detects wall changes and holds or reverts them
- Insights: runtime, cycles, short cycling, room vs thermostat, humidity
- Room sensors: any Z-Wave node with a temperature reading appears under Rooms. Optional room-aware setpoint nudge.
- Filter reminder: set the last-changed date and interval by hand, get a countdown and a reminder
- ntfy push notifications: 14 individually toggled alerts (all off by default), including connection lost/restored, thermostat silent/back, freeze, no heat, filter due/overdue, low battery, wall changes
- Future tab: planned Z-Wave add-ons (leak, door/window, dehumidifier plug, duct probes, outdoor temp, energy monitor)
- Demo mode runs a simulator, so it works before the hardware arrives

## First run on real hardware
1. Plug in the stick (use the extension cable), install the app.
2. Open `http://umbrel.local:8091` (Z-Wave JS UI). Settings → Z-Wave: pick the stick, RF region **USA**. Settings → Home Assistant: enable **WS Server**, port 3000.
3. Manage Nodes → Add the thermostat (and any sensors).
4. In Cold Front: Settings → Switch to Live.

If the stick does not show up in the serial port list, tell me which `/dev/serial/by-id/` name the Umbrel shows, and the compose file gets an exact device mapping.

## Status
The backend has 56 automated tests. The Z-Wave link was written from the zwave-js-server protocol and has NOT been tested against real hardware yet.

Cold Front is not affiliated with or endorsed by Honeywell, Zooz, the Z-Wave Alliance or Umbrel. MIT license.
