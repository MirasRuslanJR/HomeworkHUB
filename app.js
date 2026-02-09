// ============================================
// FIREBASE CONFIGURATION
// ============================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendEmailVerification,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    where, 
    getDocs,
    getDoc,
    doc,
    updateDoc,
    deleteDoc,
    setDoc,
    orderBy,
    Timestamp,
    onSnapshot,
    increment,
    arrayUnion,
    arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase конфигурация - ЗАМЕНИТЕ НА СВОЮ!
const firebaseConfig = {
    apiKey: "AIzaSyAqwhaz_726NPUVhtmDI8W6Xuo4GCQNUWM",
    authDomain: "hw-helper-b47ca.firebaseapp.com",
    projectId: "hw-helper-b47ca",
    storageBucket: "hw-helper-b47ca.appspot.com",
    messagingSenderId: "939392073070",
    appId: "1:939392073070:web:7d0a4508459ea9e586557f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================
// GLOBAL STATE
// ============================================
let currentUser = null;
let currentClass = null;
let currentHomeworkData = [];
let currentView = 'dashboard';
let homeworkUnsubscribe = null;
let notificationsUnsubscribe = null;

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Показывает toast уведомление
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Проверка домена email
 */
function isValidEmail(email) {
    return email.endsWith('@ura.nis.edu.kz');
}

/**
 * Форматирование даты
 */
function formatDate(date) {
    const options = { 
        day: 'numeric', 
        month: 'short', 
        hour: '2-digit', 
        minute: '2-digit' 
    };
    return date.toLocaleDateString('ru-RU', options);
}

/**
 * Генерирует код класса
 */
function generateClassCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Очищает текстовый ввод от опасных символов
 */
function sanitizeInput(input, maxLength = 1000) {
    if (!input) return '';
    
    const div = document.createElement('div');
    div.textContent = input;
    let cleaned = div.innerHTML;
    
    cleaned = cleaned.substring(0, maxLength);
    cleaned = cleaned.replace(/[<>]/g, '');
    
    return cleaned.trim();
}

/**
 * Проверяет, не является ли текст спамом
 */
function isSpam(text) {
    const repeatingPattern = /(.)\1{10,}/;
    if (repeatingPattern.test(text)) return true;
    
    const suspiciousLinks = /(bit\.ly|tinyurl|goo\.gl)/i;
    if (suspiciousLinks.test(text)) return true;
    
    const capsRatio = (text.match(/[A-ZА-Я]/g) || []).length / text.length;
    if (text.length > 20 && capsRatio > 0.7) return true;
    
    return false;
}

// ============================================
// RATE LIMITING
// ============================================
const rateLimiter = {
    actions: {},
    
    canPerform(action, maxPerMinute = 5) {
        const now = Date.now();
        const key = currentUser ? `${currentUser.uid}_${action}` : `guest_${action}`;
        
        if (!this.actions[key]) {
            this.actions[key] = [];
        }
        
        this.actions[key] = this.actions[key].filter(
            time => now - time < 60000
        );
        
        if (this.actions[key].length >= maxPerMinute) {
            return false;
        }
        
        this.actions[key].push(now);
        return true;
    },
    
    clear(action) {
        const key = currentUser ? `${currentUser.uid}_${action}` : `guest_${action}`;
        delete this.actions[key];
    }
};

// ============================================
// IMAGE VALIDATION
// ============================================

/**
 * Проверяет и сжимает изображение
 */
async function validateAndCompressImage(file) {
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
        throw new Error('Файл слишком большой. Максимум 2MB');
    }
    
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
        throw new Error('Неподдерживаемый формат. Используй JPG, PNG или WebP');
    }
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                let width = img.width;
                let height = img.height;
                const maxDimension = 1920;
                
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = (height / width) * maxDimension;
                        width = maxDimension;
                    } else {
                        width = (width / height) * maxDimension;
                        height = maxDimension;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                
                const compressed = canvas.toDataURL('image/jpeg', 0.7);
                
                const compressedSize = compressed.length * 0.75;
                if (compressedSize > maxSize) {
                    reject(new Error('Даже после сжатия файл слишком большой'));
                } else {
                    resolve(compressed);
                }
            };
            
            img.onerror = () => reject(new Error('Ошибка загрузки изображения'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Ошибка чтения файла'));
        reader.readAsDataURL(file);
    });
}

// ============================================
// PARTICLE ANIMATION
// ============================================
function initParticles() {
    const canvas = document.getElementById('particles');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const particleCount = 50;
    
    class Particle {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.vx = (Math.random() - 0.5) * 0.5;
            this.vy = (Math.random() - 0.5) * 0.5;
            this.size = Math.random() * 2 + 1;
        }
        
        update() {
            this.x += this.vx;
            this.y += this.vy;
            
            if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
            if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
        }
        
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 217, 255, 0.5)';
            ctx.fill();
        }
    }
    
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        particles.forEach(particle => {
            particle.update();
            particle.draw();
        });
        
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 150) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(0, 217, 255, ${0.2 * (1 - distance / 150)})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
        
        requestAnimationFrame(animate);
    }
    
    animate();
    
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

// ============================================
// AUTHENTICATION
// ============================================

// Регистрация
const registerForm = document.getElementById('register-form');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!rateLimiter.canPerform('register', 3)) {
            showToast('Слишком много попыток. Подожди минуту.', 'error');
            return;
        }
        
        const name = sanitizeInput(document.getElementById('register-name').value, 100);
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const classCode = document.getElementById('register-class-code').value.trim().toUpperCase();
        
        if (!name) {
            showToast('Введите имя', 'error');
            return;
        }
        
        if (!isValidEmail(email)) {
            showToast('Используйте email с доменом @ura.nis.edu.kz', 'error');
            return;
        }
        
        if (password.length < 6) {
            showToast('Пароль должен содержать минимум 6 символов', 'error');
            return;
        }
        
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            await updateProfile(user, { displayName: name });
            await sendEmailVerification(user);
            
            await setDoc(doc(db, 'users', user.uid), {
                name: name,
                email: email,
                points: 0,
                completedHomework: [],
                createdAt: Timestamp.now()
            });
            
            if (classCode) {
                await joinClassByCode(user.uid, classCode);
            }
            
            showToast('Аккаунт создан! Проверьте email для подтверждения.', 'success');
            
            // Показываем экран верификации
            showVerificationScreen(email);
            
        } catch (error) {
            console.error('Registration error:', error);
            let errorMessage = 'Ошибка при регистрации';
            
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = 'Email уже используется';
            } else if (error.code === 'auth/weak-password') {
                errorMessage = 'Слишком слабый пароль';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Неверный формат email';
            }
            
            showToast(errorMessage, 'error');
        }
    });
}

// Вход
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!rateLimiter.canPerform('login', 5)) {
            showToast('Слишком много попыток. Подожди минуту.', 'error');
            return;
        }
        
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        
        if (!email || !password) {
            showToast('Заполните все поля', 'error');
            return;
        }
        
        try {
            await signInWithEmailAndPassword(auth, email, password);
            showToast('Добро пожаловать!', 'success');
        } catch (error) {
            console.error('Login error:', error);
            let errorMessage = 'Неверный email или пароль';
            
            if (error.code === 'auth/user-not-found') {
                errorMessage = 'Пользователь не найден';
            } else if (error.code === 'auth/wrong-password') {
                errorMessage = 'Неверный пароль';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Слишком много попыток. Попробуйте позже';
            }
            
            showToast(errorMessage, 'error');
        }
    });
}

// Выход
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await signOut(auth);
            showToast('Вы вышли из аккаунта', 'info');
        } catch (error) {
            console.error('Logout error:', error);
            showToast('Ошибка при выходе', 'error');
        }
    });
}

// ИСПРАВЛЕННАЯ функция показа экрана верификации
function showVerificationScreen(email) {
    const loginPage = document.getElementById('login-page');
    const registerPage = document.getElementById('register-page');
    const verificationScreen = document.getElementById('verification-screen');
    const verificationEmail = document.getElementById('verification-email');
    const authContainer = document.getElementById('auth-container');
    
    // Скрываем формы логина и регистрации
    if (loginPage) {
        loginPage.classList.remove('active');
        loginPage.style.display = 'none';
    }
    if (registerPage) {
        registerPage.classList.remove('active');
        registerPage.style.display = 'none';
    }
    
    // ВАЖНО: Показываем экран верификации и ОСТАВЛЯЕМ auth-container активным
    if (verificationScreen) {
        verificationScreen.style.display = 'block';
        verificationScreen.classList.add('active');
    }
    if (authContainer) {
        authContainer.classList.add('active');
    }
    if (verificationEmail) {
        verificationEmail.textContent = email;
    }
}

const checkVerificationBtn = document.getElementById('check-verification-btn');
if (checkVerificationBtn) {
    checkVerificationBtn.addEventListener('click', async () => {
        if (!currentUser) {
            showToast('Пользователь не найден', 'error');
            return;
        }
        
        try {
            await currentUser.reload();
            
            if (currentUser.emailVerified) {
                showToast('Email подтвержден! Добро пожаловать!', 'success');
                
                const verificationScreen = document.getElementById('verification-screen');
                if (verificationScreen) {
                    verificationScreen.style.display = 'none';
                    verificationScreen.classList.remove('active');
                }
                
                // Принудительно перезагружаем страницу для повторной проверки состояния
                setTimeout(() => {
                    location.reload();
                }, 500);
            } else {
                showToast('Email еще не подтвержден. Проверь почту.', 'error');
            }
        } catch (error) {
            console.error('Error checking verification:', error);
            showToast('Ошибка проверки. Попробуй позже.', 'error');
        }
    });
}

const resendVerificationBtn = document.getElementById('resend-verification-btn');
if (resendVerificationBtn) {
    resendVerificationBtn.addEventListener('click', async () => {
        if (!currentUser) {
            showToast('Пользователь не найден', 'error');
            return;
        }
        
        try {
            await sendEmailVerification(currentUser);
            showToast('Письмо отправлено повторно!', 'success');
            resendVerificationBtn.disabled = true;
            
            const originalHTML = resendVerificationBtn.innerHTML;
            resendVerificationBtn.innerHTML = '<span>Письмо отправлено</span>';
            
            setTimeout(() => {
                resendVerificationBtn.disabled = false;
                resendVerificationBtn.innerHTML = originalHTML;
            }, 60000);
        } catch (error) {
            console.error('Error resending verification:', error);
            showToast('Ошибка отправки. Попробуй позже.', 'error');
        }
    });
}

const verificationLogoutBtn = document.getElementById('verification-logout-btn');
if (verificationLogoutBtn) {
    verificationLogoutBtn.addEventListener('click', async () => {
        await signOut(auth);
    });
}


// ИСПРАВЛЕННОЕ отслеживание состояния авторизации
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        
        // Проверяем верификацию email
        if (!user.emailVerified) {
            console.log('Email not verified');
            showVerificationScreen(user.email);
            return; // Останавливаем выполнение, но экран верификации уже показан правильно
        }
        
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            
            if (!userDoc.exists()) {
                console.error('User document not found');
                showToast('Ошибка загрузки профиля', 'error');
                return;
            }
            
            const userData = userDoc.data();
            
            // Обновляем UI
            const userInitial = document.getElementById('user-initial');
            const userName = document.getElementById('user-name-display');
            const userEmail = document.getElementById('user-email-display');
            const userPoints = document.getElementById('user-points');
            const completedCount = document.getElementById('completed-count');
            
            if (userInitial) userInitial.textContent = user.displayName?.[0]?.toUpperCase() || 'U';
            if (userName) userName.textContent = user.displayName || 'Пользователь';
            if (userEmail) userEmail.textContent = user.email;
            if (userPoints) userPoints.textContent = userData?.points || 0;
            if (completedCount) completedCount.textContent = userData?.completedHomework?.length || 0;
            
            // Показываем приложение
            const authContainer = document.getElementById('auth-container');
            const appContainer = document.getElementById('app-container');
            const verificationScreen = document.getElementById('verification-screen');
            const loginPage = document.getElementById('login-page');
            const registerPage = document.getElementById('register-page');
            
            // Скрываем все экраны авторизации
            if (verificationScreen) {
                verificationScreen.style.display = 'none';
                verificationScreen.classList.remove('active');
            }
            if (loginPage) {
                loginPage.style.display = '';
                loginPage.classList.remove('active');
            }
            if (registerPage) {
                registerPage.style.display = '';
                registerPage.classList.remove('active');
            }
            if (authContainer) authContainer.classList.remove('active');
            if (appContainer) appContainer.classList.add('active');
            
            console.log('✅ Пользователь авторизован:', user.email);
            
            await loadUserClass(user.uid);
            loadNotifications();
            
        } catch (error) {
            console.error('Error loading user data:', error);
            showToast('Ошибка загрузки данных пользователя', 'error');
        }
        
    } else {
        currentUser = null;
        currentClass = null;
        currentHomeworkData = [];
        
        if (homeworkUnsubscribe) {
            homeworkUnsubscribe();
            homeworkUnsubscribe = null;
        }
        
        if (notificationsUnsubscribe) {
            notificationsUnsubscribe();
            notificationsUnsubscribe = null;
        }
        
        console.log('⚠️ Пользователь не авторизован');
        
        const authContainer = document.getElementById('auth-container');
        const appContainer = document.getElementById('app-container');
        const verificationScreen = document.getElementById('verification-screen');
        const loginPage = document.getElementById('login-page');
        const registerPage = document.getElementById('register-page');
        
        if (appContainer) appContainer.classList.remove('active');
        if (verificationScreen) {
            verificationScreen.style.display = 'none';
            verificationScreen.classList.remove('active');
        }
        if (authContainer) authContainer.classList.add('active');
        
        // Показываем форму логина
        if (loginPage) {
            loginPage.style.display = '';
            loginPage.classList.add('active');
        }
        if (registerPage) {
            registerPage.style.display = '';
            registerPage.classList.remove('active');
        }
    }
});

// Переключение между логином и регистрацией
const showRegisterBtn = document.getElementById('show-register');
const showLoginBtn = document.getElementById('show-login');
const loginPage = document.getElementById('login-page');
const registerPage = document.getElementById('register-page');

if (showRegisterBtn && loginPage && registerPage) {
    showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginPage.classList.remove('active');
        registerPage.classList.add('active');
    });
}

if (showLoginBtn && loginPage && registerPage) {
    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        registerPage.classList.remove('active');
        loginPage.classList.add('active');
    });
}

// ============================================
// CLASS MANAGEMENT
// ============================================

async function loadUserClass(userId) {
    try {
        const userClassQuery = query(
            collection(db, 'classMembers'),
            where('userId', '==', userId)
        );
        
        const userClassSnapshot = await getDocs(userClassQuery);
        
        if (!userClassSnapshot.empty) {
            const memberDoc = userClassSnapshot.docs[0];
            const classId = memberDoc.data().classId;
            
            const classDoc = await getDoc(doc(db, 'classes', classId));
            
            if (classDoc.exists()) {
                currentClass = {
                    id: classDoc.id,
                    ...classDoc.data()
                };
                
                updateClassDisplay();
                loadHomework(classId);
            }
        } else {
            console.log('Пользователь не в классе');
            const badge = document.getElementById('current-class-badge');
            if (badge) {
                badge.style.cursor = 'pointer';
                badge.onclick = () => openModal('class-modal');
            }
        }
    } catch (error) {
        console.error('Error loading user class:', error);
    }
}

function updateClassDisplay() {
    const className = document.getElementById('class-name');
    const classCodeDisplay = document.getElementById('class-code-display');
    
    if (currentClass) {
        if (className) className.textContent = currentClass.name;
        if (classCodeDisplay) classCodeDisplay.textContent = `(${currentClass.code})`;
    } else {
        if (className) className.textContent = 'Выберите класс';
        if (classCodeDisplay) classCodeDisplay.textContent = '';
    }
}

async function updateClassInfo() {
    const currentClassInfo = document.getElementById('current-class-info');
    const currentClassNameDisplay = document.getElementById('current-class-name-display');
    const currentClassCodeDisplay = document.getElementById('current-class-code-display');
    const currentClassMembers = document.getElementById('current-class-members');
    
    if (currentClass) {
        if (currentClassInfo) currentClassInfo.style.display = 'block';
        if (currentClassNameDisplay) currentClassNameDisplay.textContent = currentClass.name;
        if (currentClassCodeDisplay) currentClassCodeDisplay.textContent = currentClass.code;
        
        const membersQuery = query(
            collection(db, 'classMembers'),
            where('classId', '==', currentClass.id)
        );
        const membersSnapshot = await getDocs(membersQuery);
        if (currentClassMembers) currentClassMembers.textContent = membersSnapshot.size;
    } else {
        if (currentClassInfo) currentClassInfo.style.display = 'none';
    }
}

const createClassForm = document.getElementById('create-class-form');
if (createClassForm) {
    createClassForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentUser) {
            showToast('Необходима авторизация', 'error');
            return;
        }
        
        const className = sanitizeInput(document.getElementById('class-name-input').value, 50);
        
        if (!className) {
            showToast('Введите название класса', 'error');
            return;
        }
        
        try {
            const code = generateClassCode();
            
            const classRef = await addDoc(collection(db, 'classes'), {
                name: className,
                code: code,
                creatorId: currentUser.uid,
                createdAt: Timestamp.now()
            });
            
            await setDoc(doc(db, 'classMembers', `${classRef.id}_${currentUser.uid}`), {
                classId: classRef.id,
                userId: currentUser.uid,
                joinedAt: Timestamp.now()
            });
            
            currentClass = {
                id: classRef.id,
                name: className,
                code: code,
                creatorId: currentUser.uid
            };
            
            document.getElementById('class-code-value').textContent = code;
            document.getElementById('generated-code').style.display = 'block';
            
            updateClassDisplay();
            updateClassInfo();
            
            showToast('Класс создан успешно!', 'success');
            createClassForm.reset();
            
        } catch (error) {
            console.error('Error creating class:', error);
            showToast('Ошибка создания класса', 'error');
        }
    });
}

const joinClassForm = document.getElementById('join-class-form');
if (joinClassForm) {
    joinClassForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentUser) {
            showToast('Необходима авторизация', 'error');
            return;
        }
        
        const code = document.getElementById('join-code-input').value.trim().toUpperCase();
        
        if (!code) {
            showToast('Введите код класса', 'error');
            return;
        }
        
        try {
            await joinClassByCode(currentUser.uid, code);
            joinClassForm.reset();
        } catch (error) {
            console.error('Error in join form:', error);
        }
    });
}

async function joinClassByCode(userId, code) {
    try {
        const classQuery = query(
            collection(db, 'classes'),
            where('code', '==', code)
        );
        
        const classSnapshot = await getDocs(classQuery);
        
        if (classSnapshot.empty) {
            showToast('Класс с таким кодом не найден', 'error');
            return;
        }
        
        const classDoc = classSnapshot.docs[0];
        const classId = classDoc.id;
        
        const existingMemberDoc = await getDoc(doc(db, 'classMembers', `${classId}_${userId}`));
        
        if (existingMemberDoc.exists()) {
            showToast('Вы уже в этом классе', 'info');
            return;
        }
        
        await setDoc(doc(db, 'classMembers', `${classId}_${userId}`), {
            classId: classId,
            userId: userId,
            joinedAt: Timestamp.now()
        });
        
        currentClass = {
            id: classId,
            ...classDoc.data()
        };
        
        updateClassDisplay();
        updateClassInfo();
        loadHomework(classId);
        
        showToast('Вы присоединились к классу!', 'success');
        closeModal('class-modal');
        
    } catch (error) {
        console.error('Error joining class:', error);
        showToast('Ошибка при присоединении к классу', 'error');
    }
}

const copyCodeBtn = document.getElementById('copy-code-btn');
if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
        const codeValue = document.getElementById('class-code-value').textContent;
        navigator.clipboard.writeText(codeValue).then(() => {
            showToast('Код скопирован!', 'success');
        }).catch(err => {
            console.error('Could not copy code:', err);
            showToast('Не удалось скопировать код', 'error');
        });
    });
}

// ============================================
// HOMEWORK MANAGEMENT
// ============================================

function loadHomework(classId) {
    if (homeworkUnsubscribe) {
        homeworkUnsubscribe();
    }
    
    const hwQuery = query(
        collection(db, 'homework'),
        where('classId', '==', classId)
    );
    
    homeworkUnsubscribe = onSnapshot(hwQuery, (snapshot) => {
        currentHomeworkData = [];
        
        snapshot.forEach(docSnapshot => {
            currentHomeworkData.push({
                id: docSnapshot.id,
                ...docSnapshot.data()
            });
        });
        
        currentHomeworkData.sort((a, b) => {
            return a.deadline.toDate() - b.deadline.toDate();
        });
        
        renderHomework();
    }, (error) => {
        console.error('Error in homework snapshot:', error);
        showToast('Ошибка загрузки заданий', 'error');
    });
}

function renderHomework(filter = 'all') {
    const container = document.getElementById('homework-list');
    if (!container) return;
    
    let filteredHomework = currentHomeworkData;
    
    if (filter === 'active') {
        filteredHomework = currentHomeworkData.filter(hw => 
            !hw.completedBy?.includes(currentUser?.uid)
        );
    } else if (filter === 'completed') {
        filteredHomework = currentHomeworkData.filter(hw => 
            hw.completedBy?.includes(currentUser?.uid)
        );
    }
    
    if (filteredHomework.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <h3>Нет заданий</h3>
                <p>Добавь первое задание для своего класса!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filteredHomework.map(hw => {
        const deadline = hw.deadline.toDate();
        const now = new Date();
        const isOverdue = deadline < now;
        const isCompleted = hw.completedBy?.includes(currentUser?.uid);
        
        return `
            <div class="homework-card ${isCompleted ? 'completed' : ''} ${isOverdue && !isCompleted ? 'overdue' : ''}" 
                 onclick="openHomeworkDetail('${hw.id}')">
                <div class="hw-subject">${sanitizeInput(hw.subject, 100)}</div>
                <div class="hw-description">${sanitizeInput(hw.description, 200)}</div>
                <div class="hw-meta">
                    <span class="hw-deadline ${isOverdue && !isCompleted ? 'overdue' : ''}">
                        ⏰ ${formatDate(deadline)}
                    </span>
                    <span class="hw-author">👤 ${sanitizeInput(hw.authorName, 50)}</span>
                </div>
                ${isCompleted ? '<div class="completed-badge">✓ Выполнено</div>' : ''}
            </div>
        `;
    }).join('');
}

const addHomeworkForm = document.getElementById('add-homework-form');
if (addHomeworkForm) {
    addHomeworkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentUser || !currentClass) {
            showToast('Выберите класс', 'error');
            return;
        }
        
        if (!rateLimiter.canPerform('add_homework', 10)) {
            showToast('Слишком много заданий. Подожди минуту.', 'error');
            return;
        }
        
        const subject = sanitizeInput(document.getElementById('hw-subject').value, 100);
        const description = sanitizeInput(document.getElementById('hw-description').value, 1000);
        const deadlineStr = document.getElementById('hw-deadline').value;
        
        if (!subject || !description || !deadlineStr) {
            showToast('Заполните все поля', 'error');
            return;
        }
        
        if (isSpam(subject) || isSpam(description)) {
            showToast('Обнаружен спам. Проверьте текст.', 'error');
            return;
        }
        
        try {
            const deadline = Timestamp.fromDate(new Date(deadlineStr));
            
            await addDoc(collection(db, 'homework'), {
                classId: currentClass.id,
                subject: subject,
                description: description,
                deadline: deadline,
                authorId: currentUser.uid,
                authorName: currentUser.displayName || 'Пользователь',
                completedBy: [],
                createdAt: Timestamp.now()
            });
            
            showToast('Задание добавлено!', 'success');
            addHomeworkForm.reset();
            closeModal('add-homework-modal');
            
        } catch (error) {
            console.error('Error adding homework:', error);
            showToast('Ошибка добавления задания', 'error');
        }
    });
}

window.openHomeworkDetail = async function(homeworkId) {
    const homework = currentHomeworkData.find(hw => hw.id === homeworkId);
    if (!homework) return;
    
    document.getElementById('detail-subject').textContent = homework.subject;
    document.getElementById('detail-description').textContent = homework.description;
    document.getElementById('detail-deadline').textContent = formatDate(homework.deadline.toDate());
    document.getElementById('detail-author').textContent = homework.authorName;
    
    const isCompleted = homework.completedBy?.includes(currentUser?.uid);
    const completeBtn = document.getElementById('mark-complete-btn');
    const proofUploadArea = document.getElementById('proof-upload-area');
    const proofPreview = document.getElementById('proof-preview');
    const proofsSection = document.getElementById('proofs-section');
    
    if (isCompleted) {
        completeBtn.style.display = 'none';
        proofUploadArea.style.display = 'none';
        
        const proofDoc = await getDoc(doc(db, 'proofs', `${homeworkId}_${currentUser.uid}`));
        if (proofDoc.exists()) {
            const proofData = proofDoc.data();
            document.getElementById('proof-image').src = proofData.imageData;
            proofPreview.style.display = 'block';
        }
        
        proofsSection.style.display = 'block';
        await loadOtherProofs(homeworkId);
    } else {
        completeBtn.style.display = 'block';
        proofUploadArea.style.display = 'block';
        proofPreview.style.display = 'none';
        proofsSection.style.display = 'none';
    }
    
    completeBtn.onclick = () => markHomeworkComplete(homeworkId);
    
    openModal('homework-detail-modal');
    
    window.currentHomeworkId = homeworkId;
};

const uploadProofBtn = document.getElementById('upload-proof-btn');
const proofFileInput = document.getElementById('proof-file');

if (uploadProofBtn && proofFileInput) {
    uploadProofBtn.addEventListener('click', () => {
        proofFileInput.click();
    });
    
    proofFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const compressedImage = await validateAndCompressImage(file);
            
            window.currentProofImage = compressedImage;
            
            document.getElementById('proof-image').src = compressedImage;
            document.getElementById('proof-upload-area').style.display = 'none';
            document.getElementById('proof-preview').style.display = 'block';
            
            showToast('Фото загружено! Теперь отметь задание выполненным.', 'success');
            
        } catch (error) {
            showToast(error.message, 'error');
        }
    });
}

const removeProofBtn = document.getElementById('remove-proof-btn');
if (removeProofBtn) {
    removeProofBtn.addEventListener('click', () => {
        window.currentProofImage = null;
        document.getElementById('proof-file').value = '';
        document.getElementById('proof-upload-area').style.display = 'block';
        document.getElementById('proof-preview').style.display = 'none';
    });
}

async function markHomeworkComplete(homeworkId) {
    if (!currentUser) return;
    
    if (!rateLimiter.canPerform('complete_homework', 20)) {
        showToast('Слишком быстро! Подожди немного.', 'error');
        return;
    }
    
    if (!window.currentProofImage) {
        showToast('Сначала загрузи доказательство выполнения!', 'error');
        return;
    }
    
    try {
        await setDoc(doc(db, 'proofs', `${homeworkId}_${currentUser.uid}`), {
            homeworkId: homeworkId,
            userId: currentUser.uid,
            userName: currentUser.displayName || 'Пользователь',
            imageData: window.currentProofImage,
            createdAt: Timestamp.now()
        });
        
        await updateDoc(doc(db, 'homework', homeworkId), {
            completedBy: arrayUnion(currentUser.uid)
        });
        
        await updateDoc(doc(db, 'users', currentUser.uid), {
            points: increment(1),
            completedHomework: arrayUnion(homeworkId)
        });
        
        const homework = currentHomeworkData.find(hw => hw.id === homeworkId);
        await sendNotificationToClass(
            `Новое доказательство по "${homework.subject}"`,
            `${currentUser.displayName} выполнил задание`
        );
        
        showToast('Задание выполнено! +1 балл', 'success');
        
        closeModal('homework-detail-modal');
        window.currentProofImage = null;
        
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const userPoints = document.getElementById('user-points');
        const completedCount = document.getElementById('completed-count');
        if (userPoints) userPoints.textContent = userDoc.data()?.points || 0;
        if (completedCount) completedCount.textContent = userDoc.data()?.completedHomework?.length || 0;
        
    } catch (error) {
        console.error('Error completing homework:', error);
        showToast('Ошибка при выполнении задания', 'error');
    }
}

async function loadOtherProofs(homeworkId) {
    if (!currentUser) return;
    
    try {
        const proofsQuery = query(
            collection(db, 'proofs'),
            where('homeworkId', '==', homeworkId)
        );
        
        const proofsSnapshot = await getDocs(proofsQuery);
        const proofs = [];
        
        proofsSnapshot.forEach(docSnapshot => {
            const proofData = docSnapshot.data();
            if (proofData.userId !== currentUser.uid) {
                proofs.push(proofData);
            }
        });
        
        const container = document.getElementById('other-proofs-grid');
        if (!container) return;
        
        if (proofs.length === 0) {
            container.innerHTML = '<p class="info-text">Пока нет доказательств от других</p>';
            return;
        }
        
        container.innerHTML = proofs.map(proof => `
            <div class="proof-item">
                <img src="${proof.imageData}" alt="Доказательство ${sanitizeInput(proof.userName, 50)}">
                <div class="proof-info">
                    <span class="proof-author">${sanitizeInput(proof.userName, 50)}</span>
                    <button class="btn-report" onclick="reportProof('${proof.homeworkId}', '${proof.userId}')">
                        ⚠️ Пожаловаться
                    </button>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading proofs:', error);
    }
}

window.reportProof = function(homeworkId, proofUserId) {
    window.reportingProof = { homeworkId, proofUserId };
    openModal('report-modal');
};

const reportForm = document.getElementById('report-form');
if (reportForm) {
    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!window.reportingProof || !currentUser) return;
        
        const reason = sanitizeInput(document.getElementById('report-reason').value, 500);
        
        if (!reason) {
            showToast('Опиши причину жалобы', 'error');
            return;
        }
        
        try {
            await addDoc(collection(db, 'reports'), {
                homeworkId: window.reportingProof.homeworkId,
                reportedUserId: window.reportingProof.proofUserId,
                reporterId: currentUser.uid,
                reason: reason,
                createdAt: Timestamp.now(),
                status: 'pending'
            });
            
            showToast('Жалоба отправлена. Спасибо!', 'success');
            closeModal('report-modal');
            reportForm.reset();
            
        } catch (error) {
            console.error('Error submitting report:', error);
            showToast('Ошибка отправки жалобы', 'error');
        }
    });
}

// ============================================
// CALENDAR
// ============================================

function generateCalendar() {
    const calendarDays = document.getElementById('calendar-days');
    if (!calendarDays) return;
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    document.getElementById('current-month').textContent = now.toLocaleDateString('ru-RU', { 
        month: 'long', 
        year: 'numeric' 
    });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = '';
    
    const startDay = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < startDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const isToday = day === now.getDate();
        
        const dayHomework = currentHomeworkData.filter(hw => {
            const hwDate = hw.deadline.toDate();
            return hwDate.getDate() === day && 
                   hwDate.getMonth() === month && 
                   hwDate.getFullYear() === year;
        });
        
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${dayHomework.length > 0 ? 'has-homework' : ''}">
                <div class="day-number">${day}</div>
                ${dayHomework.length > 0 ? `<div class="homework-count">${dayHomework.length}</div>` : ''}
            </div>
        `;
    }
    
    calendarDays.innerHTML = html;
}

// ============================================
// LEADERBOARD
// ============================================

async function loadLeaderboard(scope = 'class') {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;
    
    try {
        let users = [];
        
        if (scope === 'class' && currentClass) {
            const membersQuery = query(
                collection(db, 'classMembers'),
                where('classId', '==', currentClass.id)
            );
            
            const membersSnapshot = await getDocs(membersQuery);
            const userIds = membersSnapshot.docs.map(doc => doc.data().userId);
            
            for (const userId of userIds) {
                const userDoc = await getDoc(doc(db, 'users', userId));
                if (userDoc.exists()) {
                    users.push({
                        id: userId,
                        ...userDoc.data()
                    });
                }
            }
        } else {
            const usersSnapshot = await getDocs(collection(db, 'users'));
            usersSnapshot.forEach(docSnapshot => {
                users.push({
                    id: docSnapshot.id,
                    ...docSnapshot.data()
                });
            });
        }
        
        users.sort((a, b) => (b.points || 0) - (a.points || 0));
        
        if (users.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🏆</div>
                    <h3>Пока нет данных</h3>
                </div>
            `;
            return;
        }
        
        container.innerHTML = users.map((user, index) => {
            const isCurrentUser = user.id === currentUser?.uid;
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
            
            return `
                <div class="leaderboard-item ${isCurrentUser ? 'current-user' : ''}">
                    <div class="rank">
                        ${medal || `#${index + 1}`}
                    </div>
                    <div class="user-info">
                        <div class="user-avatar-small">
                            ${user.name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div class="user-details">
                            <div class="user-name">${sanitizeInput(user.name || 'Пользователь', 50)}</div>
                            <div class="user-stats">
                                ${user.completedHomework?.length || 0} заданий выполнено
                            </div>
                        </div>
                    </div>
                    <div class="user-points">
                        ${user.points || 0} 🏆
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        showToast('Ошибка загрузки рейтинга', 'error');
    }
}

// ============================================
// COMPLETED HOMEWORK
// ============================================

async function loadCompletedHomework() {
    const container = document.getElementById('completed-homework-list');
    if (!container || !currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const completedIds = userDoc.data()?.completedHomework || [];
        
        if (completedIds.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">✅</div>
                    <h3>Пока нет выполненных заданий</h3>
                </div>
            `;
            return;
        }
        
        const completedHomework = currentHomeworkData.filter(hw => 
            completedIds.includes(hw.id)
        );
        
        container.innerHTML = completedHomework.map(hw => `
            <div class="homework-card completed">
                <div class="hw-subject">${sanitizeInput(hw.subject, 100)}</div>
                <div class="hw-description">${sanitizeInput(hw.description, 200)}</div>
                <div class="hw-meta">
                    <span class="hw-deadline">⏰ ${formatDate(hw.deadline.toDate())}</span>
                </div>
                <div class="completed-badge">✓ Выполнено</div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading completed homework:', error);
    }
}

// ============================================
// NOTIFICATIONS
// ============================================

async function sendNotificationToClass(title, message) {
    if (!currentClass) return;
    
    try {
        const membersQuery = query(
            collection(db, 'classMembers'),
            where('classId', '==', currentClass.id)
        );
        
        const membersSnapshot = await getDocs(membersQuery);
        
        const notifications = [];
        membersSnapshot.forEach(memberDoc => {
            const userId = memberDoc.data().userId;
            if (userId !== currentUser?.uid) {
                notifications.push(
                    setDoc(doc(collection(db, 'notifications')), {
                        userId: userId,
                        title: title,
                        message: message,
                        read: false,
                        createdAt: Timestamp.now()
                    })
                );
            }
        });
        
        await Promise.all(notifications);
        
    } catch (error) {
        console.error('Error sending notifications:', error);
    }
}

async function loadNotifications() {
    if (!currentUser) return;
    
    try {
        if (notificationsUnsubscribe) {
            notificationsUnsubscribe();
        }
        
        const notifQuery = query(
            collection(db, 'notifications'),
            where('userId', '==', currentUser.uid)
        );
        
        notificationsUnsubscribe = onSnapshot(notifQuery, (snapshot) => {
            const notifications = [];
            snapshot.forEach(docSnapshot => {
                notifications.push({
                    id: docSnapshot.id,
                    ...docSnapshot.data()
                });
            });
            
            notifications.sort((a, b) => {
                return b.createdAt.toDate() - a.createdAt.toDate();
            });
            
            renderNotifications(notifications);
            
            const unreadCount = notifications.filter(n => !n.read).length;
            const notifDot = document.querySelector('.notification-dot');
            if (notifDot) {
                notifDot.style.display = unreadCount > 0 ? 'block' : 'none';
            }
        }, (error) => {
            console.error('Error in notifications snapshot:', error);
        });
        
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function renderNotifications(notifications) {
    const container = document.getElementById('notifications-list');
    if (!container) return;
    
    if (notifications.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔔</div>
                <h3>Нет уведомлений</h3>
            </div>
        `;
        return;
    }
    
    container.innerHTML = notifications.map(notif => `
        <div class="notification-item ${!notif.read ? 'unread' : ''}" onclick="markNotificationRead('${notif.id}')">
            <div class="notification-title">${sanitizeInput(notif.title, 100)}</div>
            <div class="notification-message">${sanitizeInput(notif.message, 200)}</div>
            <div class="notification-time">${formatDate(notif.createdAt.toDate())}</div>
        </div>
    `).join('');
}

window.markNotificationRead = async function(notificationId) {
    try {
        await updateDoc(doc(db, 'notifications', notificationId), {
            read: true
        });
    } catch (error) {
        console.error('Error marking notification read:', error);
    }
};

// ============================================
// UI CONTROLS
// ============================================

// Навигация
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        if (view) switchView(view);
    });
});

function switchView(viewName) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === viewName) {
            item.classList.add('active');
        }
    });
    
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    
    const targetView = document.getElementById(`${viewName}-view`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    currentView = viewName;
    
    if (viewName === 'calendar') {
        generateCalendar();
    } else if (viewName === 'leaderboard') {
        loadLeaderboard('class');
    } else if (viewName === 'completed') {
        loadCompletedHomework();
    }
}

// Фильтры домашних заданий
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        if (filter) renderHomework(filter);
    });
});

// Вкладки рейтинга
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const scope = btn.dataset.scope;
        if (scope) loadLeaderboard(scope);
    });
});

// Модальные окна
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        if (modalId) closeModal(modalId);
    });
});

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
});

// Кнопки открытия модалок
const addHomeworkBtn = document.getElementById('add-homework-btn');
if (addHomeworkBtn) {
    addHomeworkBtn.addEventListener('click', () => {
        if (!currentClass) {
            showToast('Сначала выберите класс', 'error');
            return;
        }
        openModal('add-homework-modal');
    });
}

const manageClassBtn = document.getElementById('manage-class');
if (manageClassBtn) {
    manageClassBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal('class-modal');
        updateClassInfo();
    });
}

const viewProfileBtn = document.getElementById('view-profile');
if (viewProfileBtn) {
    viewProfileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showToast('Функция в разработке', 'info');
    });
}

// Выпадающее меню пользователя
const userAvatar = document.getElementById('user-avatar');
const userDropdown = document.getElementById('user-dropdown');

if (userAvatar && userDropdown) {
    userAvatar.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('active');
    });
    
    document.addEventListener('click', (e) => {
        if (userDropdown && !userDropdown.contains(e.target) && e.target !== userAvatar) {
            userDropdown.classList.remove('active');
        }
    });
}

// Панель уведомлений
const notificationsBtn = document.getElementById('notifications-btn');
const notificationPanel = document.getElementById('notification-panel');
const closeNotifications = document.getElementById('close-notifications');

if (notificationsBtn && notificationPanel) {
    notificationsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationPanel.classList.toggle('active');
    });
}

if (closeNotifications && notificationPanel) {
    closeNotifications.addEventListener('click', () => {
        notificationPanel.classList.remove('active');
    });
}

document.addEventListener('click', (e) => {
    if (notificationPanel && 
        !notificationPanel.contains(e.target) && 
        e.target !== notificationsBtn &&
        !notificationsBtn.contains(e.target)) {
        notificationPanel.classList.remove('active');
    }
});

// ============================================
// INITIALIZATION
// ============================================

window.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Приложение инициализировано');
    initParticles();
    
    const deadlineInput = document.getElementById('hw-deadline');
    if (deadlineInput) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        deadlineInput.min = now.toISOString().slice(0, 16);
    }
});

// Prevent accidental page close with unsaved changes
window.addEventListener('beforeunload', (e) => {
    const modals = document.querySelectorAll('.modal.active');
    if (modals.length > 0) {
        e.preventDefault();
        e.returnValue = '';
    }
});

console.log('✅ HomeWorkHub загружен успешно');