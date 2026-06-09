import express from "express";
import path from "path";
import http from "http";
import { Server } from "socket.io";

const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: "*",
    },
});

app.use(express.static("dist"));

// Lightweight health check the loading screen hits to wake the server.
// Idle free-tier hosts sleep when inactive and cold-start on the first
// request; pinging this while the menu loads hides that spin-up time.
// MUST stay above the "*" catch-all below, which would otherwise swallow it
// and return index.html.
app.get("/ping", (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.json({ status: "ok", time: Date.now() });
});

const indexPath = path.join(process.cwd(), "dist", "index.html");

app.get("*", (req, res) => {
    res.sendFile(indexPath);
});

// Chat Name Space ----------------------------------------

const chatNameSpace = io.of("/chat");

chatNameSpace.on("connection", (socket) => {
    socket.userData = {
        name: "",
    };
    console.log(`${socket.id} has connected to chat namespace`);

    socket.on("disconnect", () => {
        console.log(`${socket.id} has disconnected`);
    });

    socket.on("setName", (name) => {
        socket.userData.name = name;
    });

    socket.on("send-message", (message, time) => {
        socket.broadcast.emit(
            "recieved-message",
            socket.userData.name,
            message,
            time
        );
    });
});

// Update Name Space ----------------------------------------
const updateNameSpace = io.of("/update");

const connectedSockets = new Map();
let hostId = null; // the client authoritative for all parked (un-driven) cars

updateNameSpace.on("connection", (socket) => {
    socket.userData = {
        position: { x: 0, y: -500, z: -500 },
        quaternion: { x: 0, y: 0, z: 0, w: 0 },
        animation: "idle",
        name: "",
        avatarSkin: "",
        inVehicle: false,
        vehicleId: -1,
        health: 100,
        dead: false,
        weaponMode: "hand",
    };
    connectedSockets.set(socket.id, socket);

    console.log(`${socket.id} has connected to update namespace`);

    // Designate a host (authority for parked cars) if there isn't one, and
    // tell everyone who it is. Relay the host's parked-car transforms to all
    // other clients so they all see identical positions for un-driven cars.
    if (hostId === null) hostId = socket.id;
    updateNameSpace.emit("hostId", hostId);

    socket.on("updateCars", (cars) => {
        socket.broadcast.emit("carData", cars);
    });

    // Combat: relay a fired shot to everyone else (cosmetic tracer), and relay
    // a hit to just the victim, who applies the damage to their own health.
    socket.on("shoot", (data) => {
        socket.broadcast.emit("playerShoot", data);
    });

    socket.on("playerHit", ({ targetId, damage } = {}) => {
        const target = connectedSockets.get(targetId);
        if (target) target.emit("hitByPlayer", damage, socket.id);
    });

    socket.on("setID", () => {
        updateNameSpace.emit("setID", socket.id);
    });

    socket.on("setName", (name) => {
        socket.userData.name = name;
    });

    socket.on("setAvatar", (avatarSkin) => {
        // console.log("setting avatar " + avatarSkin);
        updateNameSpace.emit("setAvatarSkin", avatarSkin, socket.id);
    });

    socket.on("disconnect", () => {
        console.log(`${socket.id} has disconnected`);
        connectedSockets.delete(socket.id);
        updateNameSpace.emit("removePlayer", socket.id);

        // If the host left, hand authority for parked cars to another client
        if (socket.id === hostId) {
            hostId =
                connectedSockets.size > 0
                    ? connectedSockets.keys().next().value
                    : null;
            updateNameSpace.emit("hostId", hostId);
        }
    });

    socket.on("initPlayer", (player) => {
        // console.log(player);
    });

    socket.on("updatePlayer", (player) => {
        socket.userData.position.x = player.position.x;
        socket.userData.position.y = player.position.y;
        socket.userData.position.z = player.position.z;
        socket.userData.quaternion.x = player.quaternion[0];
        socket.userData.quaternion.y = player.quaternion[1];
        socket.userData.quaternion.z = player.quaternion[2];
        socket.userData.quaternion.w = player.quaternion[3];
        socket.userData.animation = player.animation;
        socket.userData.avatarSkin = player.avatarSkin;
        socket.userData.vehicleId = Number.isInteger(player.vehicleId)
            ? player.vehicleId
            : -1;
        socket.userData.inVehicle = socket.userData.vehicleId >= 0;
        socket.userData.health = Number.isFinite(player.health)
            ? player.health
            : 100;
        socket.userData.dead = !!player.dead;
        socket.userData.weaponMode = player.weaponMode === "gun" ? "gun" : "hand";
    });

    setInterval(() => {
        const playerData = [];
        for (const socket of connectedSockets.values()) {
            if (
                socket.userData.name !== "" &&
                socket.userData.avatarSkin !== ""
            ) {
                playerData.push({
                    id: socket.id,
                    name: socket.userData.name,
                    position_x: socket.userData.position.x,
                    position_y: socket.userData.position.y,
                    position_z: socket.userData.position.z,
                    quaternion_x: socket.userData.quaternion.x,
                    quaternion_y: socket.userData.quaternion.y,
                    quaternion_z: socket.userData.quaternion.z,
                    quaternion_w: socket.userData.quaternion.w,
                    animation: socket.userData.animation,
                    avatarSkin: socket.userData.avatarSkin,
                    inVehicle: socket.userData.inVehicle,
                    vehicleId: socket.userData.vehicleId,
                    health: socket.userData.health,
                    dead: socket.userData.dead,
                    weaponMode: socket.userData.weaponMode,
                });
            }
        }

        if (socket.userData.name === "" || socket.userData.avatarSkin === "") {
            return;
        } else {
            // hostId rides along so every client always knows the current host,
            // even if it missed the one-shot "hostId" event on connect.
            updateNameSpace.emit("playerData", playerData, hostId);
        }
    }, 20);
});

server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
