class SharedStorage {
  static set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to save data in SharedStorage: ${error}`);
    }
  }

  static get(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Failed to get data from SharedStorage: ${error}`);
      return null;
    }
  }

  static remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove data from SharedStorage: ${error}`);
    }
  }

  static clear() {
    try {
      localStorage.clear();
    } catch (error) {
      console.error(`Failed to clear SharedStorage: ${error}`);
    }
  }
}

// 將 SharedStorage 添加到全域範圍
window.SharedStorage = SharedStorage;
