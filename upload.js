const fs = require('fs')
const xml2js = require('xml2js')
const ftp = require('ftp')
const path = require('path')

let total = 0;
let count = 0;

function show_help() {
    console.log(`Usage: sylixos-upload <xml file path> [ftp user] [ftp password] [ftp port]\n\tdefault ftp user:root, password:root, port:21\n`)
    console.log('Example: sylixos-upload .reproject.xml root root 21\n\t sylixos-upload .reproject.xml')
}
if (!process.argv[2] || process.argv[2] === '-h' || process.argv[2] === '--h' || process.argv[2] === '--help') {
    show_help();
    process.exit(0)
}

process.env.WORKSPACE_mt7916 = "/Volumes/Other/Project/01_Xspirit2WiFi/DevWorkspace/mt7916"

// get xml path
const xmlFilePath = process.argv[2]
if (process.argv.length < 3) {
    show_help();
    process.exit(1);
} else {
    console.log(`xmlFilePath: ${xmlFilePath}`)
}

const configmkFilePath = path.join(path.dirname(xmlFilePath), 'config.mk')

// set DEBUG_LEVEL env
async function setDebugLevelEnv(configmkFilePath) {
    let data = null;
    try {
        data = await fs.promises.readFile(configmkFilePath, 'utf8');
    } catch (err) {
        console.error(err);
        return;
    }

    const match = data.match(/DEBUG_LEVEL\s*:=\s*(\w+)/);
    if (match) {
        process.env.Output = match[1];
    } else {
        console.log('DEBUG_LEVEL not found, ENV \'Output\' set to release default.');
        process.env.Output = 'release'
    }
}

process.env.WORKSPACE_libdrv_linux_compat = "/Volumes/Other/Project/01_Xspirit2WiFi/DevWorkspace/libdrv_linux_compat"

// get ftp config
const ftpUser = process.argv[3] ? process.argv[3] : 'root'
const ftpPassword = process.argv[4] ? process.argv[4] : 'root'
const ftpPort = process.argv[5] ? process.argv[5] : 21

// read xml file and get upload path and ftp server
async function readXmlFile(xmlFilePath) {
    let data = null;
    let xml_data = null;

    try {
        data = await fs.promises.readFile(xmlFilePath, 'utf8');
    } catch (err) {
        console.error(err);
        return;
    }

    const parser = new xml2js.Parser({
        explicitArray: false,
        explicitRoot: true,
        mergeAttrs: true,
    })

    try {
        xml_data = await parser.parseStringPromise(data);
    } catch (err) {
        console.error(err);
        return;
    }

    const pairItems = xml_data.SylixOSSetting.UploadPath.PairItem
    const uploadPaths = Array.isArray(pairItems) ? pairItems : [pairItems]
    const ftpServer = xml_data.SylixOSSetting.DeviceSetting.DevName

    return {
        ftpServer,
        uploadPaths,
    }
}

// send single file
async function uploadFile(FtpClient, localPath, remotePath) {
    const dir = path.dirname(remotePath);
    // create directory
    try {
        await new Promise((resolve, reject) => {
            FtpClient.mkdir(dir, true, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    } catch (err) {
        console.log(`uploadFile ${localFile} => ${remoteFile} create dir failed`);
        throw err;
    }

    // check file exist
    try {
        await fs.promises.access(localPath, fs.constants.F_OK);
    } catch (err) {
        console.log(`uploadFile ${localFile} => ${remoteFile} access failed`);
        throw err;
    }

    // upload file
    try {
        await new Promise((resolve, reject) => {
            FtpClient.put(localPath, remotePath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        console.log(`[${count}/${total}][OK]\t${localPath} => ${remotePath}`);
    } catch (err) {
        console.log(`[${count}/${total}][Failed]\tuploadFile ${localFile} => ${remoteFile} put failed`);
        throw err;
    }
}


async function uploadDir(FtpClient, localPath, remotePath) {
    // upload files
    const files = await fs.promises.readdir(localPath);

    for (const file of files) {
        try {
            const localFilePath = path.join(localPath, file);
            const remoteFilePath = path.join(remotePath, file);
            const stats = await fs.promises.stat(localFilePath);

            if (stats.isDirectory()) {
                // upload directory
                try {
                    await uploadDir(FtpClient, localFilePath, remoteFilePath);
                } catch (err) {
                    return;
                }
            } else if (stats.isFile()) {
                try {
                    await uploadFile(FtpClient, localFilePath, remoteFilePath);
                } catch (err) {
                    return;
                }
            } else {
                console.error(`[${count}/${total}][Failed]\t${localFilePath} is neither a file nor a directory`);
                return;
            }
        } catch (err) {
            console.error(`[${count}/${total}][Failed]\t${localFilePath} Error getting stats for : ${err}`);
            return;
        }
    }
}


// send all files
async function uploadFiles(FtpClient, UploadXmlPath) {
    total = UploadXmlPath.length;

    for (const XmlPath of UploadXmlPath) {
        count++;

        let localPathOK = true;
        let localPath = XmlPath.key
        const remotePath = XmlPath.value

        const matches = localPath.match(/\$\((.*?)\)/g);
        if (matches) {
            for (const match of matches) {
                const envVarName = match.substring(2, match.length - 1);
                const envVarValue = process.env[envVarName];

                if (envVarValue) {
                    localPath = path.normalize(localPath.replace(match, envVarValue)).replace(/\\/g, '/');
                } else {
                    console.error(`[${count}/${total}][Failed]\t ${localPath}: Environment variable ${envVarName} is not defined.`)
                    localPathOK = false;
                    break;
                }
            }
        }

        if (!localPathOK) {
            continue;
        }

        // check localPath is file or directory
        try {
            const stats = await fs.promises.stat(localPath);
            if (stats.isDirectory()) {
                // upload directory
                try {
                    await uploadDir(FtpClient, localPath, remotePath);
                } catch (err) {
                    console.error(`[${count}/${total}][Failed]\t${err}`);
                    continue;
                }
            } else if (stats.isFile()) {
                try {
                    await uploadFile(FtpClient, localPath, remotePath);
                } catch (err) {
                    console.error(`[${count}/${total}][Failed]\t${err}`);
                    continue;
                }
            } else {
                console.error(`[${count}/${total}][Failed]\t${path} is neither a file nor a directory`);
                continue;
            }
        } catch (err) {
            console.error(`[${count}/${total}][Failed]\tError getting stats for ${path}: ${err}`);
            continue;
        }
    }
}

// upload a local file to the server
async function upload2FtpServer(FtpServer, UploadXmlPath) {
    return new Promise(async (resolve, reject) => {
        const FtpClient = new ftp();

        try {
            await new Promise((resolve, reject) => {
                FtpClient.on('ready', () => {
                    resolve();
                });

                FtpClient.on('error', (err) => {
                    reject(err);
                });

                FtpClient.connect(FtpServer);
            });

            console.log(`Connected to FTP server ${FtpServer.host} Successfully!`)
            console.log(`Start Upload ===================================>`)

            await uploadFiles(FtpClient, UploadXmlPath);

            FtpClient.end();
            resolve();
        } catch (err) {
            FtpClient.end();
            reject(err);
        }
    });
}

setDebugLevelEnv(configmkFilePath).then(() => {
    readXmlFile(xmlFilePath).then((data) => {
        const { ftpServer, uploadPaths } = data;

        upload2FtpServer({ host: ftpServer, user: ftpUser, password: ftpPassword, port: ftpPort }, uploadPaths).then().catch((err) => {
            console.error(err);
        });
    }).catch((err) => {
        console.error(err);
    });
}).catch((err) => {
    console.error(err);
});
