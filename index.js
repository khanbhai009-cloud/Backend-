// index.js (Corrected for ES Module Syntax)

import 'dotenv/config'; // ESM way to load environment variables
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
// Use ESM imports for Firebase SDK
import { 
    initializeApp 
} from "firebase/app";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    increment, 
    query, 
    collection, 
    where, 
    getDocs, 
    serverTimestamp 
} from "firebase/firestore";

// --- Configuration ---

// ⚠️ Replace with your actual Bot Token
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'; 

// ⚠️ Replace with your actual Firebase Configuration (FIXED: Must be a constant/variable)
const firebaseConfig = { // <-- Corrected: Declared as a constant object
  apiKey: "AIzaSyCY64NxvGWFC_SZxcAFX3ImNQwY3H-yclw",
  authDomain: "tg-web-bot.firebaseapp.com",
  projectId: "tg-web-bot",
  storageBucket: "tg-web-bot.firebasestorage.app",
  messagingSenderId: "69446541874",
  appId: "1:69446541874:web:1ad058194db70530ff922b"
};

const REWARD_AMOUNT = 500;
const WELCOME_IMAGE_URL = 'https://i.ibb.co/932298pT/file-32.jpg';
const WEB_APP_URL = 'https://khanbhai009-cloud.github.io/Tg-bot';

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Telegram Bot Initialization ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- Firestore Helper Functions (Functions remain the same) ---

/**
 * Creates or updates a user document in Firestore.
 */
async function createOrEnsureUser(userId, firstName, photoURL, referralId = null) {
    const userRef = doc(db, "users", String(userId));
    const docSnap = await getDoc(userRef);

    if (docSnap.exists()) {
        await updateDoc(userRef, {
            name: firstName,
            photoURL: photoURL,
            refferBy: docSnap.data().refferBy === null && referralId !== null ? referralId : docSnap.data().refferBy,
        });
        console.log(`User ${userId} updated.`);
    } else {
        await setDoc(userRef, {
            id: String(userId),
            name: firstName,
            photoURL: photoURL,
            coins: 0,
            reffer: 0,
            refferBy: referralId, 
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false,
            rewardGiven: false
        }, { merge: true });
        console.log(`New user ${userId} created with referral: ${referralId}`);
    }
}

/**
 * Updates a single field for a user.
 */
async function updateField(userId, field, value) {
    const userRef = doc(db, "users", String(userId));
    await updateDoc(userRef, {
        [field]: value
    });
}

/**
 * Increments a field by a specified amount for a user.
 */
async function incrementField(userId, field, amount) {
    const userRef = doc(db, "users", String(userId));
    await updateDoc(userRef, {
        [field]: increment(amount)
    });
}

/**
 * Rewards the referrer of a newly qualified user (userIdB).
 */
async function rewardReferrer(userIdB, referrerIdA) {
    console.log(`Processing reward for referrer ${referrerIdA} from user ${userIdB}`);

    // 1. Increment referrer's fields
    try {
        await incrementField(referrerIdA, 'coins', REWARD_AMOUNT);
        await incrementField(referrerIdA, 'reffer', 1);
        console.log(`Referrer ${referrerIdA} rewarded with ${REWARD_AMOUNT} coins and 1 reffer.`);
    } catch (error) {
        console.error(`Error rewarding referrer ${referrerIdA}:`, error.message);
        return;
    }

    // 2. Set users/{B}.rewardGiven = true
    try {
        await updateField(userIdB, 'rewardGiven', true);
        console.log(`User ${userIdB} marked as rewardGiven=true.`);
    } catch (error) {
        console.error(`Error updating user ${userIdB} rewardGiven:`, error.message);
    }

    // 3. Create ledger (ref_rewards/{B})
    try {
        const ledgerRef = doc(db, "ref_rewards", String(userIdB));
        await setDoc(ledgerRef, {
            userId: String(userIdB),
            referrerId: String(referrerIdA),
            reward: REWARD_AMOUNT,
            createdAt: serverTimestamp()
        });
        console.log(`Referral ledger created for user ${userIdB}.`);
    } catch (error) {
        console.error(`Error creating ledger for user ${userIdB}:`, error.message);
    }

    // Optional: Notify the referrer
    try {
        await bot.sendMessage(referrerIdA, `🎉 **Referral Bonus!** 🎉\nYou've earned ${REWARD_AMOUNT} coins because your referred user opened the app!`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.warn(`Could not send notification to referrer ${referrerIdA}. They might have blocked the bot.`);
    }
}

// --- Telegram Bot Handlers (Handler remains the same) ---

/**
 * Handles the /start command.
 */
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromUser = msg.from;
    const userId = fromUser.id;
    const firstName = fromUser.first_name || 'Guest';

    const referralMatch = match[1].trim().match(/^ref(\w+)/);
    const referralId = referralMatch ? referralMatch[1] : null;

    const photoURL = ''; 

    // 1. Create or merge Firestore document
    await createOrEnsureUser(userId, firstName, photoURL, referralId);

    // 2. Return welcome image + buttons
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
            [{ 
                text: "▶ Open App", 
                web_app: { 
                    url: WEB_APP_URL 
                } 
            }],
            [{ 
                text: "📢 Channel", 
                url: "https://t.me/finisher_tech" 
            }],
            [{ 
                text: "🌐 Community", 
                url: "https://t.me/finisher_techg" 
            }]
        ]
    };

    try {
        await bot.sendPhoto(chatId, WELCOME_IMAGE_URL, {
            caption: welcomeCaption,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        console.error("Error sending welcome message/photo:", error.message);
        // Fallback to text message if photo fails
        await bot.sendMessage(chatId, welcomeCaption, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
});


// --- Referral Logic (Interval Worker Style - Logic remains the same) ---

/**
 * The worker function that checks for users who have just qualified for a referral reward.
 * Condition: frontendOpened=true AND rewardGiven=false AND refferBy!=null
 */
async function referralRewardWorker() {
    console.log("Worker: Checking for pending referral rewards...");

    const usersRef = collection(db, "users");

    // Query users that meet all three conditions for a reward
    const q = query(
        usersRef, 
        where("frontendOpened", "==", true),
        where("rewardGiven", "==", false),
        where("refferBy", "!=", null) 
    );

    try {
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log("Worker: No users found needing a referral reward.");
            return;
        }

        console.log(`Worker: Found ${querySnapshot.size} users needing a reward.`);

        querySnapshot.forEach(async (docSnap) => {
            const userData = docSnap.data();
            const userIdB = docSnap.id;
            const referrerIdA = userData.refferBy;

            if (userIdB && referrerIdA) {
                if (userIdB !== referrerIdA) {
                    await rewardReferrer(userIdB, referrerIdA);
                } else {
                    console.log(`Skipping self-referral check for user ${userIdB}. Marking as rewarded.`);
                    await updateField(userIdB, 'rewardGiven', true);
                }
            }
        });

    } catch (error) {
        console.error("Worker Error during Firestore query:", error.message);
    }
}

// Start the interval worker (runs every 5 seconds)
setInterval(referralRewardWorker, 5000); 

// --- Express Server (Server code remains the same) ---

const appServer = express();
const port = process.env.PORT || 3000;

appServer.get('/', (req, res) => {
  res.send('Telegram Bot Backend is running!');
});

appServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
