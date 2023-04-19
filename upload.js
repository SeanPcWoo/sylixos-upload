const fs = require('fs')
const xml2js = require('xml2js')
const ftp = require('ftp')
const path = require('path')

function show_help () {
    console.log(`Usage: sylixos-upload <xml file path> [ftp user] [ftp password] [ftp port]\n\tdefault ftp user:root, password:root, port:21\n`)
    console.log('Example: sylixos-upload .reproject.xml root root 21\n\t sylixos-upload .reproject.xml')
}
if (!process.argv[2] || process.argv[2] === '-h' || process.argv[2] === '--h' || process.argv[2] === '--help') {
    show_help();
    process.exit(0)
}

// get xml path
const xmlFilePath = process.argv[2]
if (process.argv.length < 3) {
    show_help();
    process.exit(1);
} else {
    console.log(`xmlFilePath: ${xmlFilePath}`)
}

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

// send all files
async function uploadFiles (FtpClient, UploadXmlPath) {
    const total = UploadXmlPath.length;
    let   count = 0;

    for (const XmlPath of UploadXmlPath) {
        count++;

        let localPath = XmlPath.key
        const remotePath = XmlPath.value

        const matches = localPath.match(/\$\((.*?)\)/);

        if (matches) {
            const envVarName = matches[1];
            const envVarValue = process.env[envVarName];

            if (envVarValue) {
                localPath = path.normalize(localPath.replace(matches[0], envVarValue)).replace(/\\/g, '/');
            } else {
                console.error(`[${count}/${total}][Failed]\t ${localPath}: Environment variable ${envVarName} is not defined.`)
                continue;
            }
        }

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
            console.error(`[${count}/${total}][Failed]\tError creating directory ${dir}: ${err}`);
            continue;
        }
    
        // check file exist
        try {
            await fs.promises.access(localPath, fs.constants.F_OK);
        } catch (err) {
            console.error(`[${count}/${total}][Failed]\t${err}`);
            continue;
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
            console.error(`[${count}/${total}][Failed]\t${err}`);
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
            console.log(`Start Upload ===================================>!`)
  
            await uploadFiles(FtpClient, UploadXmlPath);

            FtpClient.end();
            resolve();
        } catch (err) {
            FtpClient.end();
            reject(err);
        }
    });
}
  
readXmlFile(xmlFilePath).then((data) => {
    const { ftpServer, uploadPaths } = data;

    upload2FtpServer({host:ftpServer, user:ftpUser, password:ftpPassword, port:ftpPort}, uploadPaths).then().catch((err) => {
        console.error(err);
    });
}).catch((err) => {
    console.error(err);
});
