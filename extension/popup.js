"use strict";

const browserApi = globalThis.browser || globalThis.chrome;
const statusEl = document.getElementById("status");

function sendMessage(message) {
  return new Promise((resolve) => {
    browserApi.runtime.sendMessage(message, resolve);
  });
}

async function refresh() {
  statusEl.textContent = "检查服务状态...";
  const response = await sendMessage({ type: "JEP_HEALTH" });
  if (!response?.ok) {
    statusEl.textContent = response?.error || "服务未连接";
    return;
  }
  statusEl.textContent = `服务在线\nPID ${response.result.pid}，端口 ${response.result.port}`;
}

document.getElementById("testButton").addEventListener("click", refresh);
document.getElementById("optionsButton").addEventListener("click", () => {
  browserApi.runtime.openOptionsPage();
});

refresh();
