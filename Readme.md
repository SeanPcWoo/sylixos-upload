## 源码打包成可执行文件
pkg . --targets node12-win-x64,node12-macos-x64,node12-linux-x64

## 可执行文件打成 tar 用于上传 homebrew
tar -czf sylixos-upload-macos-v1.0.0.tar.gz sylixos-upload-macos

## 计算可执行文件的 sha256
shasum -a 256 sylixos-upload-macos-v1.0.0.tar.gz |awk '{print $1}' >  sylixos-upload-macos-sha256.txt