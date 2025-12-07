/**
 * DG-LAB PawPrint JavaScript Library
 * 
 * Provides an interface to control the PawPrint BLE controller.
 * Supports:
 * - Connection/Disconnection
 * - LED Control (Internal & External)
 * - Software Blinking (Hz)
 * - Sensor Data (Buttons, Accelerometer)
 * - Derived Metrics (Tilt, Shake)
 */

export const COLORS = {
    OFF: 0x00,
    YELLOW: 0x01,
    RED: 0x02,
    VIOLET: 0x03,
    BLUE: 0x04,
    CYAN: 0x05,
    GREEN: 0x06
};

export const BUTTONS = {
    B1: 1, // Top/Left
    B2: 2, // Middle
    B3: 3  // Bottom/Right
};

export class PawPrint extends EventTarget {
    constructor() {
        super();
        this.device = null;
        this.server = null;
        this.writeChar = null;
        
        // State
        this.internalColor = COLORS.YELLOW;
        this.externalColor = COLORS.OFF;
        this.dataEnabled = false;
        
        // Sensor Data
        this.accel = { x: 0, y: 0, z: 0 };
        this.btnState = { b1: false, b2: false, b3: false }; // false=released, true=pressed
        
        // Derived Data
        this.shake = 0; // Instantaneous shake intensity
        
        // Timers
        this.blinkInterval = null;
    }

    /**
     * Request a Bluetooth Device.
     * Use this in response to a user gesture.
     */
    async scan() {
        try {
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: '47L' }, { namePrefix: 'Paw' }],
                optionalServices: ['0000180c-0000-1000-8000-00805f9b34fb', 'battery_service']
            });
            return this.device;
        } catch (e) {
            console.error("Scan cancelled or failed:", e);
            throw e;
        }
    }

    async connect(device = this.device) {
        if (!device) throw new Error("No device selected. Call scan() first.");
        
        if (device.name === '47L121000') {
            console.warn("Warning: This might be a Coyote device, not PawPrint.");
        }

        this.device = device;
        this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect());

        this.server = await this.device.gatt.connect();
        const svc = await this.server.getPrimaryService('0000180c-0000-1000-8000-00805f9b34fb');

        // Setup Write
        const chars = await svc.getCharacteristics();
        this.writeChar = chars.find(c => c.uuid.includes('150a'));
        if (!this.writeChar) throw new Error("Write characteristic not found");

        // Setup Notify
        const notifyChar = chars.find(c => c.uuid.includes('150b'));
        if (notifyChar) {
            await notifyChar.startNotifications();
            notifyChar.addEventListener('characteristicvaluechanged', (e) => this.handleData(e));
        }

        this.dispatchEvent(new Event('connected'));
    }

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.stopData();
            await this.setExternalColor(COLORS.OFF);
            this.device.gatt.disconnect();
        }
    }

    onDisconnect() {
        this.stopBlink();
        this.dispatchEvent(new Event('disconnected'));
    }

    async send(u8) {
        if (!this.writeChar) return;
        try {
            await this.writeChar.writeValue(u8);
        } catch (e) {
            console.error("TX Error:", e);
        }
    }

    // --- Commands ---

    async setInternalColor(colorId) {
        this.internalColor = colorId;
        const dataByte = this.dataEnabled ? 0xFF : 0x00;
        await this.send(new Uint8Array([0x53, this.internalColor, dataByte]));
    }

    async setExternalColor(colorId) {
        this.stopBlink(); // Stop any active blinking
        this.externalColor = colorId;
        await this.send(new Uint8Array([0x70, this.externalColor]));
    }

    async startData() {
        this.dataEnabled = true;
        await this.setInternalColor(this.internalColor); // Re-send 53 with FF
    }

    async stopData() {
        this.dataEnabled = false;
        await this.setInternalColor(this.internalColor); // Re-send 53 with 00
    }

    /**
     * Blinks the external LED between two colors at a given frequency.
     * @param {number} color1 - First Color ID
     * @param {number} color2 - Second Color ID
     * @param {number} hz - Frequency in Hertz (e.g. 2 for 2 times per second)
     */
    blinkExternal(color1, color2, hz) {
        this.stopBlink();
        const intervalMs = 1000 / hz / 2; // Half cycle for each color
        let state = false;
        
        // Immediate start
        this.send(new Uint8Array([0x70, color1]));
        
        this.blinkInterval = setInterval(() => {
            state = !state;
            const c = state ? color2 : color1;
            this.send(new Uint8Array([0x70, c]));
        }, intervalMs);
    }

    stopBlink() {
        if (this.blinkInterval) {
            clearInterval(this.blinkInterval);
            this.blinkInterval = null;
        }
    }

    // --- Data Parsing ---

    handleData(event) {
        const u8 = new Uint8Array(event.target.value.buffer);
        if (u8.length < 3) return;
        if (u8[0] === 0x51) return; // ACK packet

        // Buttons
        // Packet: [B3] [B2] [B1] ...
        const newB3 = u8[0] === 0x00;
        const newB2 = u8[1] === 0x00;
        const newB1 = u8[2] === 0x00;

        this.checkBtnChange('b1', newB1, BUTTONS.B1);
        this.checkBtnChange('b2', newB2, BUTTONS.B2);
        this.checkBtnChange('b3', newB3, BUTTONS.B3);

        // Accelerometer
        if (u8.length >= 13) {
            const x = this.getInt16(u8, 7);
            const y = this.getInt16(u8, 9);
            const z = this.getInt16(u8, 11);
            
            // Shake Calculation (Delta Magnitude)
            const dx = x - this.accel.x;
            const dy = y - this.accel.y;
            const dz = z - this.accel.z;
            this.shake = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            this.accel = { x, y, z };
            
            // Emit Data Event
            this.dispatchEvent(new CustomEvent('data', { 
                detail: { 
                    accel: this.accel, 
                    buttons: this.btnState,
                    shake: this.shake
                } 
            }));
        }
    }

    checkBtnChange(key, pressed, id) {
        if (this.btnState[key] !== pressed) {
            this.btnState[key] = pressed;
            const type = pressed ? 'buttondown' : 'buttonup';
            this.dispatchEvent(new CustomEvent(type, { detail: { button: id } }));
        }
    }

    getInt16(u8, idx) {
        let val = (u8[idx] << 8) | u8[idx + 1];
        if (val > 32767) val -= 65536;
        return val;
    }

    // --- Helpers ---

    /**
     * Returns tilt angles in degrees
     */
    getTilt() {
        const { x, y, z } = this.accel;
        const RAD_TO_DEG = 180 / Math.PI;
        // Basic roll/pitch
        const roll = Math.atan2(x, z) * RAD_TO_DEG;
        const pitch = Math.atan2(y, Math.sqrt(x*x + z*z)) * RAD_TO_DEG;
        // Full 360 Pitch alternative
        const pitch360 = Math.atan2(y, z) * RAD_TO_DEG;
        
        return { roll, pitch, pitch360 };
    }
}
