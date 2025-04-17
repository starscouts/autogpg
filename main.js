const { app, Tray, Menu, Notification, globalShortcut } = require('electron');
global.enabled = true;
global.mode = "dual";

process.env.PATH = "/usr/local/bin:" + process.env.PATH;

let lastEncrypted;
let lastClipboard;
let selectedRecipients = [];

function getKeys() {
    let keys = {};
    let recipients = {};
    let current;
    let id;
    let previous;

    for (let line of require('child_process').execSync("gpg --list-keys").toString().split("\n")) {
        if (line.startsWith("sub ")) {
            if (current && id) {
                keys[id] = current;

                if (current.length > 0) {
                    recipients[current[0]["email"]] = current[0]["display"];
                }

                id = null;
                current = null;
            }
        }

        if (line.startsWith("pub ")) {
            current = [];
        }

        if (line.startsWith("uid ") && line.includes("<") && line.includes(">") && current) {
            current.push({
                trust: line.split("[")[1].split("]")[0].trim(),
                name: line.split("]")[1].split("<")[0].trim(),
                email: line.split("<")[1].split(">")[0].trim(),
                display: line.split("]")[1].split("<")[0].trim() + " <" + line.split("<")[1].split(">")[0].trim() + "> (" + line.split("[")[1].split("]")[0].trim() + ")"
            });
        }

        if (previous && previous.startsWith("pub ") && line.startsWith("      ")) {
            id = line.substring(6);
        }

        previous = line;
    }

    return {
        keys, recipients
    };
}

function state(item) {
    global.enabled = item.checked;
    updateMenu();
}

function encryptClipboard() {
    if (selectedRecipients.length > 0) {
        try {
            let clipboard = require('child_process').execSync("pbpaste").toString().trim();
            if (clipboard.trim() === "") return;

            require('child_process').execSync(`printf "` + clipboard.trim().replaceAll('"', '\\"') + '" | gpg ' + selectedRecipients.map(i => '-r ' + i).join(" ") + " -aes | pbcopy");
            lastEncrypted = require('child_process').execSync("pbpaste").toString().trim();

            let notification = new Notification({
                title: "Text successfully encrypted",
                body: "A message for " + selectedRecipients.length + " recipient" + (selectedRecipients.length > 1 ? "s" : "") + " has been encrypted and copied.",
                sound: "Frog.aiff",
                actions: []
            });

            notification.show();
        } catch (e) {
            let notification = new Notification({
                title: "Failed to encrypt GPG message",
                body: "The text found in the clipboard could not be encrypted.",
                sound: "Sosumi.aiff",
                actions: []
            });

            notification.show();

            console.error(e);
        }
    } else {
        let notification = new Notification({
            title: "Cannot encrypt GPG message",
            body: "You have not selected any recipients, therefore encryption is not possible.",
            sound: "Sosumi.aiff",
            actions: []
        });

        notification.show();
    }
}

function changeMode() {
    global.mode = global.contextMenu.getMenuItemById("mode").submenu.items.filter(i => i.checked)[0].id;
    updateMenu();
}

function updateRecipients() {
    let keys = getKeys()['recipients'];

    return Menu.buildFromTemplate(Object.keys(keys).map(email => {
        let display = keys[email];

        return {
            id: email,
            label: display,
            type: "checkbox",
            click: changeRecipients,
            checked: selectedRecipients.includes(email)
        }
    }));
}

function changeRecipients() {
    selectedRecipients = contextMenu.getMenuItemById("recipients").submenu.items.filter(i => i.checked).map(i => i.id);
}

const createTray = () => {
    global.tray = new Tray(__dirname + '/tray/16x16Template@2x.png');

    try {
        updateMenu();

        setInterval(() => {
            updateMenu();
        }, 60000);

        setInterval(() => {
            detectClipboard();
        }, 500);
    } catch (e) {
        console.error(e);
    }
}

function detectClipboard() {
    try {
        if (mode === "encrypt" || !enabled) return;

        let clipboard = require('child_process').execSync("pbpaste").toString().trim();
        if (lastClipboard === clipboard || lastEncrypted === clipboard) return;

        if (clipboard.startsWith("-----BEGIN PGP MESSAGE-----") && clipboard.endsWith("-----END PGP MESSAGE-----")) {
            try {
                let ret = require('child_process').execSync('pbpaste | gpg --decrypt').toString().trim();
                let ret2 = require('child_process').execSync('pbpaste | gpg --decrypt 2>&1').toString().trim().split("\n");
                require('child_process').execSync(`printf "` + ret.trim().replaceAll('"', '\\"') + '" | pbcopy');

                let signature = ret2.filter(i => i.startsWith("gpg: Good signature from \"")).length > 0 ? ret2.filter(i => i.startsWith("gpg: Good signature from \""))[0].split('"')[1] : null;
                let notification;

                if (signature) {
                    notification = new Notification({
                        title: "GPG encrypted message found",
                        body: "A GPG message from " + signature + " has been decrypted and copied to your clipboard.",
                        hasReply: true,
                        sound: "Frog.aiff",
                        replyPlaceholder: "Reply and copy"
                    });
                } else {
                    notification = new Notification({
                        title: "GPG encrypted message found",
                        body: "An anonymous GPG message has been decrypted and copied to your clipboard.",
                        hasReply: true,
                        sound: "Frog.aiff",
                        replyPlaceholder: "Reply and copy"
                    });
                }

                notification.on('reply', (event, reply) => {
                    require('child_process').execSync(`printf "` + reply.trim().replaceAll('"', '\\"') + '" | pbcopy');
                    encryptClipboard();
                })

                notification.show();
            } catch (e) {
                let notification = new Notification({
                    title: "Failed to decrypt GPG message",
                    body: "The GPG message found in the clipboard could not be decrypted.",
                    sound: "Sosumi.aiff",
                    actions: []
                });

                notification.show();

                console.error(e);
            }
        }

        lastClipboard = clipboard;
        lastEncrypted = null;
    } catch (e) {
        console.error(e);
    }
}

function updateMenu() {
    try {
        global.contextMenu = Menu.buildFromTemplate([
            { label: 'Enable', type: 'checkbox', click: state, checked: enabled },
            { id: 'encrypt', label: 'Encrypt clipboard', accelerator: "CmdOrCtrl+Alt+E", enabled: global.enabled && global.mode !== "decrypt", click: encryptClipboard },
            { type: 'separator' },
            { id: "mode", label: 'Mode', type: 'submenu', submenu: Menu.buildFromTemplate([
                    { id: "dual", label: 'Encrypt and decrypt', type: 'radio', checked: true, click: changeMode },
                    { id: "decrypt", label: 'Decrypt only', type: 'radio', click: changeMode },
                    { id: "encrypt", label: 'Encrypt only', type: 'radio', click: changeMode }
                ]) },
            { id: "recipients", label: 'Recipients', type: 'submenu', submenu: updateRecipients() },
            { type: 'separator' },
            { label: 'Quit', accelerator: "CmdOrCtrl+Q", role: "quit" }
        ]);

        tray.setToolTip("AutoGPG");
        tray.setContextMenu(contextMenu);
    } catch (e) {
        console.error(e);
    }
}

app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock.hide();
    createTray();

    globalShortcut.register('Alt+CommandOrControl+E', () => {
        encryptClipboard();
    });
});