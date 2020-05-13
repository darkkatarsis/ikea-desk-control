import noble from '@abandonware/noble'
import schedule from 'node-schedule'
import Desk from './desk'
import mqtt from 'mqtt'

/**
 * @typedef {Object} DeskManagerConfig
 * @property {string} dataStorageDir
 * @property {string} deskAddress
 * @property {int} deskPositionOffset
 * @property {int} deskPositionMax
 * @property {string} mqttUrl
 * @property {string} mqttUsername
 * @property {string} mqttPassword
 */

export default class DeskManager {
  
  // ===
  // Initialize
  // ===

  /**
   * @param {DeskManagerConfig} config 
   */
  constructor(config) {
    this.config = config
    this.topicPrefix = `ikea-desk-control/desk-${config.deskAddress}`
  }

  // ===
  // Start
  // ===

  start() {
    this.startNoble()
    this.startMQTT()
  }

  startNoble() {
    noble.on('discover', async (peripheral) => {
      await this.processPeripheral(peripheral)
    })

    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        await this.scan()
      } else {
        if (this.desk) {
          this.desk.disconnect()
        }
        this.desk = null
        this.didUpdateDevice()
      }
    })

    noble.on('scanStop', async () => {
      if (!this.desk && noble.state == 'poweredOn') {
        this.scan()
      }
    })
  }

  startMQTT() {
    this.mqtt = mqtt.connect(this.config.mqttUrl, {
      username: this.config.mqttUsername,
      password: this.config.mqttPassword,
      will: {
        topic: `${this.topicPrefix}/connected`,
        payload: 'false',
      }
    })

    this.mqtt.on('connect', () => {
      this.mqtt.subscribe(`${this.topicPrefix}/command`, { qos: 2 })
      this.mqtt.on('message', (topic, messageBuffer) => {
        this.didReceiveCommand(messageBuffer.toString())
      })
      this.didConnectToMQTT()
    })
  }

  // ===
  // Scan
  // ===

  async scan() {
    try {
      await noble.startScanningAsync()
    } catch (err) {
      console.log(`Failed to start scanning: ${err}`)
      this.scheduleScan()
    }
  }

  scheduleScan() {
    schedule.scheduleJob(Date.now() + 5000, () => {
      if (noble.state == 'poweredOn') {
        this.scan()
      }
    })
  }

  /**
   * @param {noble.Peripheral} peripheral 
   */
  async processPeripheral(peripheral) {
    if (this.desk || peripheral.address != this.config.deskAddress) {
      return
    }

    try {
      await noble.stopScanningAsync()
    } catch (err) {
      // We don't really care
    }

    this.desk = new Desk(
      peripheral,
      this.config.deskPositionOffset,
      this.config.deskPositionMax
    )
    this.didUpdateDevice()
  }

  // ===
  // Utils
  // ===

  publishConnectionState() {
    this.mqtt.publish(`${this.topicPrefix}/connected`, this.desk ? 'true' : 'false', {
      qos: 2
    })
  }

  publishPosition() {
    if (!this.desk) {
      return
    }

    const status = {
      position: this.desk.position
    }
    this.mqtt.publish(`${this.topicPrefix}/status`,JSON.stringify(status), {
      qos: 0
    })
  }

  // ===
  // Events
  // ===

  didUpdateDevice() {
    if (this.desk) {
      this.desk.on('position', () => {
        this.publishPosition()
      })
    }

    if (!this.mqtt.connected) {
      return
    }

    this.publishConnectionState()
    this.publishPosition()
  }

  didConnectToMQTT() {
    this.publishConnectionState()
    this.publishPosition()
  }

  didReceiveCommand(command) {
    if (!this.desk) {
      return
    }

    try {
      const object = JSON.parse(command)
      const position = object.position
      this.desk.moveTo(position)
    } catch (err) {
      // Don't do anything
    }
  }
}