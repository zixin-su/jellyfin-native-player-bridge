"use strict";

const browserApi = globalThis.browser || globalThis.chrome;
const form = document.getElementById("settingsForm");
const statusEl = document.getElementById("status");

function sendMessage(message) {
  return new Promise((resolve) => {
    browserApi.runtime.sendMessage(message, resolve);
  });
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b91c1c" : "";
}

async function loadSettings() {
  const response = await sendMessage({ type: "JEP_GET_SETTINGS" });
  if (!response?.ok) {
    setStatus(response?.error || "读取配置失败", true);
    return;
  }
  const settings = response.settings;
  form.serviceHost.value = settings.serviceHost || "127.0.0.1";
  form.servicePort.value = settings.servicePort || 45789;
  form.serviceToken.value = settings.serviceToken || "";
  form.notifyOnSuccess.checked = Boolean(settings.notifyOnSuccess);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await sendMessage({
    type: "JEP_SAVE_SETTINGS",
    settings: {
      serviceHost: form.serviceHost.value.trim() || "127.0.0.1",
      servicePort: Number(form.servicePort.value) || 45789,
      serviceToken: form.serviceToken.value,
      notifyOnSuccess: form.notifyOnSuccess.checked
    }
  });
  if (!response?.ok) {
    setStatus(response?.error || "保存失败", true);
    return;
  }
  setStatus("已保存");
});

document.getElementById("testButton").addEventListener("click", async () => {
  setStatus("正在测试连接...");
  const response = await sendMessage({ type: "JEP_HEALTH" });
  if (!response?.ok) {
    setStatus(response?.error || "连接失败", true);
    return;
  }
  setStatus(`服务在线，PID ${response.result.pid}`);
});

document.getElementById("reloadButton").addEventListener("click", async () => {
  setStatus("正在重载配置...");
  const response = await sendMessage({ type: "JEP_RELOAD" });
  if (!response?.ok) {
    setStatus(response?.error || "重载失败", true);
    return;
  }
  setStatus(response.result.restartRequired ? "已重载，监听端口变化需要重启服务" : "已重载");
});

loadSettings();
