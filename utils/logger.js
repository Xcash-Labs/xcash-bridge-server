function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info(message, data = null) {
    if (data) {
      console.log(`[${timestamp()}] INFO: ${message}`, data);
    } else {
      console.log(`[${timestamp()}] INFO: ${message}`);
    }
  },

  warn(message, data = null) {
    if (data) {
      console.warn(`[${timestamp()}] WARN: ${message}`, data);
    } else {
      console.warn(`[${timestamp()}] WARN: ${message}`);
    }
  },

  error(message, err = null) {
    if (err) {
      console.error(`[${timestamp()}] ERROR: ${message}`, err);
    } else {
      console.error(`[${timestamp()}] ERROR: ${message}`);
    }
  }
};