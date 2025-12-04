// ==============================
// FINAL BACKEND COMPLETE FILE
// ==============================

import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from "firebase/app";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    collection,
    getDocs,
    query,
    where,
    serverTimestamp
} from "firebase/firestore";

// ==============================
// 🔥 CONFIG
// ==============================
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN";

const firebaseConfig = {
    apiKey: "AIzaSyCY64NxvGWFC_SZxcAFX3ImNQwY3H-yclw",
    authDomain: "tg-web-bot.firebaseapp.com",
    projectId: "tg-web-bot",
    storageBucket: "tg-web-bot.firebasestorage.app",
    messagingSenderId: "69446541874",
    appId: "1:69446541874:web:1ad058194db70530ff922b"
};

const REWARD_AMOUNT = 500;
const WELCOME_IMAGE_URL = "https://i.ibb.co/932298pT/file-32.jpg";
const WEB_APP_URL = "https://khanbhai009-cloud.github.io/Tg-bot";

// ==============================
// 🔥 FIREBASE INIT
// ==============================
const appFB = initializeApp(firebaseConfig);
const db = getFirestore(appFB);

// ==============================
// 🤖 TELEGRAM BOT
// ==============================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ==============================
// 🔧 HELPERS
// ==============================
async function updateField(userId, field, value) {
    await updateDoc(doc(db, "users", String(userId)), { [field]: value });
}

async function incrementField(userId, field, amount) {
    await updateDoc(doc(db, "users", String(userId)), {
        [field]: increment(amount)
    });
}

// Create or update user in Firestore
async function createOrEnsureUser(userId, name, photoURL, referralId = null) {
    const userRef = doc(db, "users", String(userId));
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
        await setDoc(
            userRef,
            {
                id: String(userId),
                name,
                photoURL,
                coins: 0,
                reffer: 0,
                refferBy: referralId || null,
                tasksCompleted: 0,
                totalWithdrawals: 0,
                frontendOpened: false,
                rewardGiven: false,
            },
            { merge: true }
        );
        console.log(`🔥 New user created ${userId} (referBy=${referralId})`);
    } else {
        await updateDoc(userRef, {
            name,
            photoURL,
            ...(referralId ? { refferBy: referralId } : {})
        });
        console.log(`ℹ Existing user updated ${userId}`);
    }
}

// Reward referrer A when user B opens app
async function rewardReferrer(userIdB, referrerIdA) {
    console.log(`🎁 Rewarding ${referrerIdA} for referral ${userIdB}`);

    await incrementField(referrerIdA, "coins", REWARD_AMOUNT);
    await incrementField(referrerIdA, "reffer", 1);
    await updateField(userIdB, "rewardGiven", true);

    await setDoc(doc(db, "ref_rewards", String(userIdB)), {
        userId: String(userIdB),
        referrerId: String(referrerIdA),
        reward: REWARD_AMOUNT,
        createdAt: serverTimestamp()
    });

    await bot.sendMessage(
        referrerIdA,
        `🎉 *Referral Bonus!*  
You earned *${REWARD_AMOUNT} coins* because your referred user opened the app.`,
        { parse_mode: "Markdown" }
    );
}

// ==============================
// 🔥 CLEAN REFERRAL ID EXTRACTOR
// ==============================
function extractReferralId(text) {
    if (!text) return null;
    const cleaned = text.replace(/[^0-9]/g, "");
    return cleaned.length > 0 ? cleaned : null;
}

// ==============================
// 🤖 BOT COMMAND: /start
// ==============================
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || "User";

    const referralId = extractReferralId(match[1]);
    const photoURL = "";

    // Create/update user
    await createOrEnsureUser(chatId, firstName, photoURL, referralId);

    // WELCOME MESSAGE
    const welcomeCaption = `👋 Hi! Welcome ${firstName} ⭐  
Yaha aap tasks complete karke real rewards kama sakte ho!

🔥 Daily Tasks  
🔥 Video Watch  
🔥 Mini Apps  
🔥 Referral Bonus  
🔥 Auto Wallet System  

**Ready to earn?**  
Tap START and your journey begins!`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "▶ Open App", web_app: { url: WEB_APP_URL } }],
            [{ text: "📢 Channel", url: "https://t.me/finisher_tech" }],
            [{ text: "🌐 Community", url: "https://t.me/finisher_techg" }]
        ]
    };

    try {
        await bot.sendPhoto(chatId, WELCOME_IMAGE_URL, {
            caption: welcomeCaption,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } catch {
        await bot.sendMessage(chatId, welcomeCaption, {
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }
});

// ==============================
// 🧠 REFERRAL DETECTION WORKER
// ==============================
async function referralWorker() {
    const usersRef = collection(db, "users");

    const q = query(
        usersRef,
        where("frontendOpened", "==", true),
        where("rewardGiven", "==", false)
    );

    const snaps = await getDocs(q);

    snaps.forEach(async (docSnap) => {
        const userData = docSnap.data();
        const userIdB = docSnap.id;
        const referrerIdA = userData.refferBy;

        if (referrerIdA && referrerIdA !== userIdB) {
            await rewardReferrer(userIdB, referrerIdA);
        }
    });
}

// every 5 sec
setInterval(referralWorker, 5000);

// ==============================
// 🌍 EXPRESS SERVER
// ==============================
const appServer = express();
const PORT = process.env.PORT || 3000;

appServer.get("/", (req, res) => {
    res.send("Backend Running ✔️");
});

appServer.listen(PORT, () =>
    console.log(`🚀 Server running on ${PORT}`)
);