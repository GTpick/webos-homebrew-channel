import EventEmitter from 'events';
import { readFileSync } from 'fs';
import Message from './message';
import { SSH } from './ssh-promise';

class Request extends EventEmitter {
    constructor(ssh) {
        super();
        this.ssh = ssh;
    }

    cancel() {
        this.ssh.close();
    }
}

export default class Handle {
    constructor(service) {
        this.service = service;
    }
    /**
     * Send a message via luna-send-pub and start interactive session
     * @param {string} uri 
     * @param {string} payload 
     * @returns EventEmitter of this session
     */
    subscribe(uri, payload) {
        const ssh = new SSH();
        var request = new Request(ssh);
        this._getSshConfig().then(config => ssh.connect(config))
            .then(() => ssh.spawn('luna-send-pub', ['-i', uri, payload]))
            .then(stream => {
                var stdout = '';
                stream.on('close', (code, signal) => {

                });
                stream.on('data', data => {
                    stdout += data.toString();
                    var searchPos = 0, breakPos = 0;
                    while ((breakPos = stdout.indexOf('\n', searchPos)) > 0) {
                        const line = stdout.substring(searchPos, breakPos).trim();
                        request.emit('response', Message.constructBody(line, true));
                        searchPos = breakPos + 1;
                    }
                    if (searchPos) {
                        stdout = stdout.substring(searchPos);
                    }
                });
            })
            .catch(err => request.emit('cancel', Message.constructBody(JSON.stringify({
                returnValue: false,
                errorCode: -1,
                errorText: `Unable to exec luna-send-pub: ${err}`,
            }), false)))
            .catch(reason => {
                if (reason.stack) {
                    console.error(reason.stack);
                }
                request.emit('cancel', Message.constructBody(JSON.stringify({
                    returnValue: false,
                    errorCode: -1,
                    errorText: `Failed to start ssh session: ${reason}`
                }), false));
            });
        return request;
    }
    /**
     * Send a message via luna-send-pub and get response
     * @param {string} uri 
     * @param {string} payload 
     * @returns Promise to response message
     */
    async call(uri, payload) {
        const ssh = new SSH();
        const config = await this._getSshConfig();
        await ssh.connect(config);
        const { stdout } = await ssh.exec('luna-send-pub', ['-n', '1', uri, JSON.stringify(payload)]);
        return Message.constructBody(stdout.trim(), false);
    }

    _getSshConfig() {
        if (!this.service.call) {
            const conf = this.service;
            // Assume this is static configuration for testing
            return new Promise((resolve, reject) => {
                resolve({
                    host: conf.host,
                    port: conf.port,
                    username: conf.username,
                    privateKey: readFileSync(conf.privateKeyPath),
                    passphrase: conf.passphrase,
                })
            });
        }
        return new Promise((resolve, reject) => {
            this.service.call('luna://com.webos.service.sm/deviceid/getIDs', { idType: ['NDUID'] }, (message) => {
                if (!message.payload.returnValue) {
                    reject('Failed to call getIDs');
                    return;
                }
                const idItem = message.payload.idList.find(item => item.idType === 'NDUID')
                if (!idItem) {
                    reject('Failed to find NDUID');
                    return;
                }
                resolve({
                    host: '127.0.0.1',
                    port: 9922,
                    username: 'prisoner',
                    privateKey: readFileSync('/var/luna/preferences/webos_rsa'),
                    passphrase: idItem.idValue.substring(0, 6).toUpperCase(),
                });
            });
        });
    }

}