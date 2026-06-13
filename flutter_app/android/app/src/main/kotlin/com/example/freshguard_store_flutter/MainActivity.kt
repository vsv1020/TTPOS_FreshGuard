package com.example.freshguard_store_flutter

import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.UUID
import kotlin.concurrent.thread

class MainActivity : FlutterActivity() {
    private val channelName = "freshguard/usb_printer"
    private val sppChannelName = "freshguard/bluetooth_spp"
    private val usbPermissionAction: String by lazy { "$packageName.USB_PERMISSION" }

    private var pendingPermissionResult: MethodChannel.Result? = null
    private var permissionReceiverRegistered = false

    // Well-known Serial Port Profile UUID for RFCOMM connections.
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    private data class UsbEndpointTarget(
        val usbInterface: UsbInterface,
        val endpoint: UsbEndpoint
    )

    private val permissionReceiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != usbPermissionAction) {
                    return
                }

                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                val callback = pendingPermissionResult
                pendingPermissionResult = null
                unregisterPermissionReceiverIfNeeded()
                callback?.success(granted)
            }
        }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler {
            call, result ->
            when (call.method) {
                "listDevices" -> handleListDevices(result)
                "requestPermission" -> handleRequestPermission(call, result)
                "write" -> handleWrite(call, result)
                else -> result.notImplemented()
            }
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, sppChannelName).setMethodCallHandler {
            call, result ->
            when (call.method) {
                "listBondedDevices" -> handleListBondedDevices(result)
                "write" -> handleSppWrite(call, result)
                else -> result.notImplemented()
            }
        }
    }

    private fun bluetoothAdapter(): BluetoothAdapter? {
        val manager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter
    }

    private fun handleListBondedDevices(result: MethodChannel.Result) {
        val adapter = bluetoothAdapter()
        if (adapter == null || !adapter.isEnabled) {
            result.error("bt_unavailable", "Bluetooth is off or unavailable.", null)
            return
        }
        try {
            val devices =
                adapter.bondedDevices.map { device ->
                    mapOf(
                        "name" to (device.name ?: ""),
                        "address" to device.address
                    )
                }
            result.success(devices)
        } catch (e: SecurityException) {
            result.error("bt_permission", "BLUETOOTH_CONNECT permission denied.", e.message)
        }
    }

    /**
     * Opens an RFCOMM socket to the well-known SPP UUID, writes [bytes], and
     * closes it. Runs off the platform thread because connect()/write() block.
     */
    private fun handleSppWrite(call: MethodCall, result: MethodChannel.Result) {
        val address = call.argument<String>("address")
        val bytes = call.argument<ByteArray>("bytes")
        if (address.isNullOrEmpty() || bytes == null) {
            result.error("invalid_args", "address and bytes are required.", null)
            return
        }
        if (bytes.isEmpty()) {
            result.error("invalid_args", "bytes must be non-empty.", null)
            return
        }

        val adapter = bluetoothAdapter()
        if (adapter == null || !adapter.isEnabled) {
            result.error("bt_unavailable", "Bluetooth is off or unavailable.", null)
            return
        }

        thread(start = true) {
            var socket: BluetoothSocket? = null
            try {
                val device = adapter.getRemoteDevice(address)
                socket = device.createRfcommSocketToServiceRecord(sppUuid)
                adapter.cancelDiscovery()
                socket.connect()
                socket.outputStream.write(bytes)
                socket.outputStream.flush()
                runOnUiThread { result.success(bytes.size) }
            } catch (e: SecurityException) {
                runOnUiThread {
                    result.error("bt_permission", "BLUETOOTH_CONNECT permission denied.", e.message)
                }
            } catch (e: Exception) {
                runOnUiThread {
                    result.error("spp_write_failed", e.message ?: "RFCOMM write failed.", null)
                }
            } finally {
                try {
                    socket?.close()
                } catch (_: Exception) {
                }
            }
        }
    }

    override fun onDestroy() {
        unregisterPermissionReceiverIfNeeded()
        super.onDestroy()
    }

    private fun usbManager(): UsbManager {
        return getSystemService(Context.USB_SERVICE) as UsbManager
    }

    private fun handleListDevices(result: MethodChannel.Result) {
        val devices =
            usbManager().deviceList.values.map { device ->
                mapOf(
                    "deviceId" to device.deviceId,
                    "vendorId" to device.vendorId,
                    "productId" to device.productId,
                    "deviceName" to device.deviceName,
                    "productName" to (device.productName ?: ""),
                    "manufacturerName" to (device.manufacturerName ?: "")
                )
            }
        result.success(devices)
    }

    private fun handleRequestPermission(call: MethodCall, result: MethodChannel.Result) {
        val deviceId = (call.argument<Number>("deviceId"))?.toInt()
        if (deviceId == null) {
            result.error("invalid_args", "deviceId is required.", null)
            return
        }

        val device = findDeviceById(deviceId)
        if (device == null) {
            result.error("device_not_found", "USB device not found for id=$deviceId.", null)
            return
        }

        val manager = usbManager()
        if (manager.hasPermission(device)) {
            result.success(true)
            return
        }

        if (pendingPermissionResult != null) {
            result.error("busy", "Another USB permission request is already in progress.", null)
            return
        }

        pendingPermissionResult = result
        registerPermissionReceiverIfNeeded()
        val intent = Intent(usbPermissionAction).setPackage(packageName)
        val flags =
            PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    PendingIntent.FLAG_MUTABLE
                } else {
                    0
                }
        val permissionIntent = PendingIntent.getBroadcast(this, deviceId, intent, flags)
        manager.requestPermission(device, permissionIntent)
    }

    private fun handleWrite(call: MethodCall, result: MethodChannel.Result) {
        val deviceId = (call.argument<Number>("deviceId"))?.toInt()
        val bytes = call.argument<ByteArray>("bytes")
        val timeoutMs = (call.argument<Number>("timeoutMs"))?.toInt() ?: 4000

        if (deviceId == null || bytes == null) {
            result.error("invalid_args", "deviceId and bytes are required.", null)
            return
        }

        if (bytes.isEmpty()) {
            result.error("invalid_args", "bytes must be non-empty.", null)
            return
        }

        val manager = usbManager()
        val device = findDeviceById(deviceId)
        if (device == null) {
            result.error("device_not_found", "USB device not found for id=$deviceId.", null)
            return
        }
        if (!manager.hasPermission(device)) {
            result.error("permission_denied", "No USB permission for device id=$deviceId.", null)
            return
        }

        val target = findBulkOutEndpoint(device)
        if (target == null) {
            result.error("endpoint_not_found", "No USB bulk OUT endpoint found.", null)
            return
        }

        val connection = manager.openDevice(device)
        if (connection == null) {
            result.error("open_failed", "Failed to open USB device connection.", null)
            return
        }

        val written = writeToEndpoint(connection, target, bytes, timeoutMs)
        connection.close()

        if (written < 0) {
            result.error("write_failed", "bulkTransfer returned $written.", null)
            return
        }

        result.success(written)
    }

    private fun writeToEndpoint(
        connection: UsbDeviceConnection,
        target: UsbEndpointTarget,
        bytes: ByteArray,
        timeoutMs: Int
    ): Int {
        if (!connection.claimInterface(target.usbInterface, true)) {
            return -1
        }

        return try {
            connection.bulkTransfer(target.endpoint, bytes, bytes.size, timeoutMs)
        } finally {
            connection.releaseInterface(target.usbInterface)
        }
    }

    private fun findDeviceById(deviceId: Int): UsbDevice? {
        return usbManager().deviceList.values.firstOrNull { it.deviceId == deviceId }
    }

    private fun findBulkOutEndpoint(device: UsbDevice): UsbEndpointTarget? {
        for (i in 0 until device.interfaceCount) {
            val usbInterface = device.getInterface(i)
            for (j in 0 until usbInterface.endpointCount) {
                val endpoint = usbInterface.getEndpoint(j)
                val isBulkOut =
                    endpoint.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                        endpoint.direction == UsbConstants.USB_DIR_OUT
                if (isBulkOut) {
                    return UsbEndpointTarget(usbInterface = usbInterface, endpoint = endpoint)
                }
            }
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun registerPermissionReceiverIfNeeded() {
        if (permissionReceiverRegistered) {
            return
        }
        val filter = IntentFilter(usbPermissionAction)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(permissionReceiver, filter)
        }
        permissionReceiverRegistered = true
    }

    private fun unregisterPermissionReceiverIfNeeded() {
        if (!permissionReceiverRegistered) {
            return
        }
        unregisterReceiver(permissionReceiver)
        permissionReceiverRegistered = false
    }
}
