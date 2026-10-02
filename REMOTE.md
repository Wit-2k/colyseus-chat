# 连接并操作云主机

## 准备

执行 `wsl` 进入本机 Linux 环境。

执行 `ssh aliyun` 连接远程主机。

可用 `exit` 断开 SSH 连接或退出 WSL。

## 验证

在云主机上执行 `curl ip.sb` 须返回 `101.132.131.12`。

在云主机上执行 `dig +short go-comm.space` 须返回 `101.132.131.12`。

## 操作

云主机已安装 docker，已创建一个名为 test-web 的 nginx 容器。容器内已配置 SSL 证书。

配置本项目产物的挂载即可。
