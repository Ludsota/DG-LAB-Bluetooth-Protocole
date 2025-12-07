# DG-LAB PawPrint Bluetooth LE Protocol

## Overview
**Device Name Prefix**: `47L` (e.g., `47L120300`)
**Connection Type**: Bluetooth Low Energy (BLE)

## Services & Characteristics

### Main Service
**UUID**: `0000180c-0000-1000-8000-00805f9b34fb`

| Characteristic | UUID | Properties | Description |
|---|---|---|---|
| **Command** | `0000150a-0000-1000-8000-00805f9b34fb` | Write / WriteWithoutResponse | Send commands to the device |
| **Feedback** | `0000150b-0000-1000-8000-00805f9b34fb` | Notify | Receive sensor data and buttons |

### Battery Service
**UUID**: `0000180f-0000-1000-8000-00805f9b34fb`
Standard BLE Battery Service (Level read).

---

## Commands (Write to 150A)

### 1. Internal LED & Data Stream
Controls the central LED and enables/disables the sensor data stream.

**Format**: `53 [ColorID] [StreamFlag]`

- **ColorID**:
  - `01`: Yellow
  - `02`: Red
  - `03`: Violet
  - `04`: Blue
  - `05`: Cyan
  - `06`: Green
- **StreamFlag**:
  - `FF`: Enable Sensor Data (Buttons + Accel)
  - `00`: Disable Sensor Data

**Example**: `53 04 FF` (Blue LED, Start Data)

### 2. External LED Ring
Controls the outer LED ring.

**Format**: `70 [ColorID]`

- **ColorID**: Same mapping as Internal LED. `00` to turn off.

**Example**: `70 02` (Red Ring)

---

## Feedback Data (Notify from 150B)

The device sends packets (approx 20Hz-50Hz when enabled) containing button states and accelerometer data.

**Packet Structure** (13+ bytes):
`[B3] [B2] [B1] [?] [?] [?] [?] [XH] [XL] [YH] [YL] [ZH] [ZL] ...`

### Buttons (Bytes 0-2)
Each byte corresponds to a button.
- Value `0x01` (or non-zero): Released
- Value `0x00`: Pressed

- **Byte 0**: Button 3 (Bottom/Right)
- **Byte 1**: Button 2 (Middle)
- **Byte 2**: Button 1 (Top/Left)

### Unknown (Bytes 3-6)
Currently unknown data. Values fluctuate.

### Accelerometer (Bytes 7-12)
3-axis accelerometer data, 16-bit signed integers, Big Endian.

- **X-Axis**: Bytes 7 (High) & 8 (Low)
- **Y-Axis**: Bytes 9 (High) & 10 (Low)
- **Z-Axis**: Bytes 11 (High) & 12 (Low)

**Formula**: `val = (High << 8) | Low` (Convert to signed 16-bit)
