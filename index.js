// index.js (Frontend Open Detection Logic)

import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
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
} from "firebase/firestore"; // Query modules are re-added

// --- Configuration ---

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'; 

// Use your Firebase config
const firebaseConfig = {
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

// --- Firestore Helper Functions ---

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
    try {
        await updateDoc(userRef, {
            [field]: increment(amount)
        });
    } catch (error) {
         console.error(`Error incrementing field ${field} for user ${userId}:`, error.message);
    }
}

/**
 * Creates or updates a user document in Firestore.
 * NOTE: This function does NOT give the reward.
 */
async function createOrEnsureUser(userId, firstName, photoURL, referralId = null) {
    const userRef = doc(db, "users", String(userId));
    const docSnap = await getDoc(userRef);
    let isNewUser = !docSnap.exists();
    let oldReferrerId = docSnap.exists() ? docSnap.data().refferBy : null;

    if (isNewUser) {
        // New user creation
        await setDoc(userRef, {
            id: String(userId),
            name: firstName,
            photoURL: photoURL,
            coins: 0,
            reffer: 0,
            refferBy: referralId, // Can be null
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false, // Initial state
            rewardGiven: false      // Reward not given yet
        }, { merge: true });
        console.log(`New user ${userId} created with referral: ${referralId}`);
    } else if (oldReferrerId === null && referralId !== null) {
        // Existing user, but referred for the first time
        await updateDoc(userRef, {
            name: firstName,
            photoURL: photoURL,
            refferBy: referralId,
        });
        console.log(`Existing user ${userId} updated with new referrer: ${referralId}`);
    } else {
        // User exists, update name/photo only
        await updateDoc(userRef, {
            name: firstName,
            photoURL: photoURL,
        });
    }
}

/**
 * Rewards the referrer (User A) only after User B opens the frontend.
 * This is called by the Interval Worker.
 */
async function rewardReferrer(userIdB, referrerIdA) {
    console.log(`Processing DELAYED reward for referrer ${referrerIdA} from qualified user ${userIdB}`);

    // 1. Increment referrer's fields
    try {
        await incrementField(referrerIdA, 'coins', REWARD_AMOUNT);
        await incrementField(referrerIdA, 'reffer', 1); // Referral count increase
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
        console.warn(`Could not send notification to referrer ${referrerIdA}.`);
    }
}


// --- Telegram Bot Handlers ---

/**
 * Handles the /start command.
 * 1. Extracts user info and referral ID.
 * 2. Creates/merges user document.
 * 3. Sends welcome message and buttons.
 */
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromUser = msg.from;
    const userId = fromUser.id;
    const firstName = fromUser.first_name || 'Guest';

    // Extract referral: /start ref123 -> "123"
    const referralMatch = match[1].trim().match(/^ref(\w+)/);
    const referralId = referralMatch ? referralMatch[1] : null;

    const photoURL = ''; 

    // 1. Create or merge Firestore document (Reward is NOT given here)
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


// --- Referral Logic (Interval Worker Style - Re-added) ---

/**
 * The worker function that checks for users who have just qualified for a referral reward.
 * Condition: frontendOpened=true AND rewardGiven=false AND refferBy!=null
 */
async function referralRewardWorker() {
    // console.log("Worker: Checking for pending referral rewards..."); // Keep this quiet unless debugging

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
            // console.log("Worker: No users found needing a referral reward."); 
            return;
        }

        console.log(`Worker: Found ${querySnapshot.size} users needing a DELAYED reward.`);
        
        querySnapshot.forEach(async (docSnap) => {
            const userData = docSnap.data();
            const userIdB = docSnap.id;
            const referrerIdA = userData.refferBy;

            if (userIdB && referrerIdA && userIdB !== referrerIdA) {
                // This user B qualified! Reward referrer A.
                await rewardReferrer(userIdB, referrerIdA);
            } else if (userIdB === referrerIdA) {
                // Self-referral protection for the worker loop
                await updateField(userIdB, 'rewardGiven', true);
            }
        });

    } catch (error) {
        // This usually means the Firestore Composite Index is missing!
        console.error("Worker Error during Firestore query: The query requires an index. Please check your Firebase console.");
        console.error("Error details:", error.message);
    }
}

// Start the interval worker (runs every 5 seconds)
setInterval(referralRewardWorker, 5000); 


// --- Express Server ---

const appServer = express();
const port = process.env.PORT || 3000;

appServer.get('/', (req, res) => {
  res.send('Telegram Bot Backend is running (Worker Active)!');
});

appServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
