# =====================================================================
# Import libraries
# =====================================================================
import network                          # Used to connect to Wi-Fi
import urequests                        # Used to handle HTTP requests
import ntptime                          # Used to get current time from NTP server
import time                             # Used to utilize the on board timer
                                        # module for delay and timestamps
import machine                          # Used to control the pins of ESP32
import sys                              # Used to take input from user
import onewire                          # Communication protocol for 1-wire device
import ds18x20                          # Used to read DS18B20 temperature sensor
import cryptolib                        # Used for AES-128 decryption
import os                               # Used for file management for local buffering
import json                             # Used for JSON file management

#====================================================================
# Constants definition
#====================================================================
TEMPERATURE_SENSOR_PIN  = 39            # DS18B20 connected at GPIO9
LIGHT_SENSOR_PIN        = 8             # TEMT6000 connected at GPIO10
ALERT_LED_PIN           = 10            # Builtin RGB LED Pin at GPIO48
TIMEZONE_OFFSET         = 6 * 3600      # Timezone offset for BD. GMT+6
WIFI_CONNECTION_TIMEOUT = 10            # Seconds to wait for Wi-Fi to connect
ADC_MAX_VALUE           = 4096          # Maximum value possibler for 12-bit ADC
ADC_REF_VOLTAGE         = 3.3           # Reference voltage for ADC
PARAM_CHK_INTERVAL      = 5             # Interval between checking temperature
                                        # and light in seconds.
EPOCH_CONVERSION_FACTOR = 946684800     # Adjustment for 1970 -> 2000 EPOCH
ENCRYPTED_FIREBASE_KEY  = b's\xd0\x85\xd5\x95\xef\xe0\xee\xe25m`\x91\x89S3|\x02\xb8\x08\xda(\x0c\x04]2C\xbd\xcf\xef\xb3v\xac\x990\xd9\x8a-\x85\xf6\xc7\xa3\xd8ex\n\x05\x1b'
                                        # Encrypted firebase key with AES-128 encryption
AES_INIT_VECTOR         = b'TheEnviroSenseIV' # AES-128 Initialization Vector
TEMPERATURE_L_LIMIT     = 28.00         # Lower limit for anomaly temperature. In °C
TEMPERATURE_U_LIMIT     = 35.00         # Upper limit for anomaly temperature  In °C
LIGHT_L_LIMIT           = 0.00          # Lower limit for anomaly light. In lux
LIGHT_U_LIMIT           = 200.00        # Upper limit for anomaly light. In lux
LOCAL_BUFFER_FILE       = "buffer.json" # Local storage file for data buffering

#====================================================================
# Method definition
#====================================================================
def init_temperature_sensor():
    print("[INFO]    Initializing DS18B20 temperature sensor")
    DS18B20_PIN         = machine.Pin(TEMPERATURE_SENSOR_PIN)
    oneWire             = onewire.OneWire(DS18B20_PIN)      # Initialize one-wire bus
    temperature_sensor  = ds18x20.DS18X20(oneWire)          # Create a DS18B20 object
    roms                = temperature_sensor.scan()         # Scan the 1-wire bus and return
                                                            # list of ROM codes (unique 64-bit addresses)
    if not roms:
        print("[ERROR]   Failed to initialize temperature sensor")
    else:
        print("[SUCCESS] Temperature sensor initialization complete")
    
    return [temperature_sensor, roms]
    
def init_light_sensor():
    print("[INFO]    Initializing TEMT6000 light sensor")
    LIGHT_SENSOR = machine.Pin(LIGHT_SENSOR_PIN)
    adc          = machine.ADC(LIGHT_SENSOR)                # Setup ADC channel at light sensor pin
    adc.atten(machine.ADC.ATTN_11DB)                        # Set attenuation level for the ADC
                                                            # Setting it to ATTN_11DB for 0-3.3V range
    print("[SUCCESS] Light sensor initialization complete")
    
    return adc

def init_alert_led():
    alert_led    = machine.Pin(ALERT_LED_PIN, machine.Pin.OUT)
    
    return alert_led

def connect_wifi():
    SSID     = input("          Enter Wi-Fi SSID    : ")
    PASSWORD = input("          Enter WiFi Password : ")
    
    print("[INFO]    Attempting to connect to Wi-Fi", end="")
    wlan = network.WLAN(network.STA_IF)                 # Set Wi-Fi module in station mode
    wlan.active(True)                                   # Power up the Wi-Fi module
    wlan.disconnect()                                   # Disconnect first to ensure clean start
    wlan.connect(SSID, PASSWORD)                        # Connect to router using Wi-Fi credentials
    
    # Wait for maximum WIFI_CONNECTION_TIMEOUT seconds to connect to Wi-Fi
    start = time.time()
    while not wlan.isconnected():
        if time.time() - start > WIFI_CONNECTION_TIMEOUT:
            print("[ERROR]   WiFi connection failed!")
            
            return False
        print(".", end="")
        time.sleep(1)
    
    # Print the IP number on successful connection
    print("\n[SUCCESS] WiFi connected successfully:", wlan.ifconfig())
    
    return True

def wifi_connected():
    wlan = network.WLAN(network.STA_IF)
    return wlan.isconnected()

def sync_time():
    try:
        ntptime.settime()                                   # Get UTC time from NTP
        print("[SUCCESS] Time synced with NTP.")
    except Exception as e:
        print("[ERROR]   NTP syncronization failed:", e)

def get_timestamp():
    current_time = int(time.time() + EPOCH_CONVERSION_FACTOR + TIMEZONE_OFFSET)    # Apply timezone offset for GMT+6 and EPOCH conversion factor

    return current_time                                                            # Return current time

def get_temperature(sensor, roms):
    sensor.convert_temp()                    # Instruct the DS18B20 sensor to start temperature conversion
    
    time.sleep_ms(750)                       # Wait 750ms to let the sensor
                                             # convert the temperature
    temperature = sensor.read_temp(roms[0])
    
    return temperature

def get_light_lux(adc):
    light_value = adc.read()                                        # Read the raw light data from ADC
    voltage     = (light_value / ADC_MAX_VALUE) * ADC_REF_VOLTAGE   # Convert raw light value to voltage
    lux         = (voltage / ADC_REF_VOLTAGE) * 1000                # Scale to ~0–1000 lux
    
    return lux

def convert_data_to_json(timestamp, temperature, light_lux):
    data = {
              "timestamp"   : timestamp,
              "temperature" : temperature,
              "light_lux"   : light_lux
           }
    
    return data

def decrypt_firebase_key():
    aes_key = input("          Enter AES-128 encryption key: ")   # Get AES key from user
    aes_key_bytes = aes_key.encode('utf-8')                       # Encode the key in bytes
    decipher = cryptolib.aes(aes_key_bytes, 2, AES_INIT_VECTOR)   # Create decryptor using 2: CBC mode
    firebase_key = decipher.decrypt(ENCRYPTED_FIREBASE_KEY)       # Decrypt the encrypted key
    
    return firebase_key[:-firebase_key[-1]].decode('utf-8')       # Return key with padding removed
    
def upload_data_to_firebase(data, key):
    FIREBASE_DATABASE_URL = "https://envirosense-b9386-default-rtdb.asia-southeast1.firebasedatabase.app/sensor_data.json"
    
    # Retrieve timestamp from JSON data. This will be used as key for each entry in the firebase
    timestamp  = data["timestamp"]
    
    # Append the data with the Firebase database URL along with the secret key.
    upload_url = FIREBASE_DATABASE_URL.replace(".json", f"/{timestamp}.json") + "?auth=" + key
    
    # Send JSON data to firebase using HTTP request
    try:
        response = urequests.put(upload_url, json=data)
        print("[INFO]    Data uploaded to firebase :", data)
        print("[INFO]    Response from firebase    :", response.text)
        response.close()
    except Exception as e:
        print("[ERROR]   Failed to upload data to firebase:", e)
        save_to_buffer(data)
        print("[INFO]    Data saved locally and will try to re-upload later")

def set_alert(led, alert_value):
    led.value(alert_value)

def check_anomaly(temperature, light):
    temperature_alert = 0
    light_alert = 0
    
    # temperature alert will be HIGH if temperature is out of normal range
    temperature_alert = temperature < TEMPERATURE_L_LIMIT or temperature > TEMPERATURE_U_LIMIT
    
    # light alert will be HIGH if light lux is out of normal range
    light_alert = light < LIGHT_L_LIMIT or light > LIGHT_U_LIMIT
    
    # Return 1 as alert if any of the alert is HIGH
    alert = temperature_alert + light_alert
    return alert

def save_to_buffer(data):
    buffer = []
    if LOCAL_BUFFER_FILE in os.listdir():
        # Read exiting buffer data first
        with open(LOCAL_BUFFER_FILE, "r") as f:
            try:
                buffer = json.load(f)
            except:
                buffer = []
    
    # Append new data to buffer
    buffer.append(data)
    
    # Re-write buffer with updated data
    with open(LOCAL_BUFFER_FILE, "w") as f:
        json.dump(buffer, f)

def upload_buffered_data_to_firebase(key):
    if LOCAL_BUFFER_FILE not in os.listdir():
        return
    
    # Read exiting buffer data
    with open(LOCAL_BUFFER_FILE, "r") as f:
        try:
            buffer = json.load(f)
        except:
            buffer = []
    
    # Upload buffer data to Firebase
    upload_success = []
    for data in buffer:
        if upload_data_to_firebase(data, key):
            upload_success.append(data)

    # Store remaining data back to buffer
    remaining = [e for e in buffer if e not in upload_success]
    with open(LOCAL_BUFFER_FILE, "w") as f:
        json.dump(remaining, f)

#====================================================================
# Main Method
#====================================================================
def main():
    # Initiate the DS18B20 temperature sensor
    temperature_sensor, roms = init_temperature_sensor()
    
    # Initialize the TEMT6000 light sensor
    light_sensor_adc = init_light_sensor()
    
    # Initialize alert LED
    alert_led = init_alert_led()
    
    # Connect to Wi-Fi
    if not connect_wifi():
        print("[INFO]    Exiting because Wi-Fi connection could not be established")
        return
    
    # Syncronize current time
    sync_time()
    
    # Get decrypted firebase key
    firebase_key = decrypt_firebase_key()
    
    print("[SUCCESS] Initialization complete.")
    print("*** EnviroSense is ready for use ***")
    
    # Main loop
    while True:
        # Get timestamp
        timestamp = get_timestamp()
        
        # Get light lux
        light_lux = get_light_lux(light_sensor_adc)
        
        # Get temperature
        temperature = get_temperature(temperature_sensor, roms)
        
        # Report sensed parameters
        print("[INFO]    [", timestamp, "] Temperature:", temperature, "°C Light:", light_lux, "lux")
        
        # Check sensor data and raise alert appropriatly
        set_alert(alert_led, check_anomaly(temperature, light_lux))
        
        # Convert raw data to JSON format
        json_data = convert_data_to_json(timestamp, temperature, light_lux)
        
        # Send data if device is online
        if wifi_connected():
            # Send data to Firebase
            upload_data_to_firebase(json_data, firebase_key)
            
            # Send locally aggregated data to firebase
            upload_buffered_data_to_firebase(firebase_key) 
        else:
            save_to_buffer(json_data)
        

        # Wait before checking next parameter
        time.sleep(PARAM_CHK_INTERVAL)

if __name__ == "__main__":
    main()
