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
            ctx.fillStyle = 'rgba(0, 217, 255, 0.3)';
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

// Verification screen handlers
function showVerificationScreen(email) {
    const loginPage = document.getElementById('login-page');
    const registerPage = document.getElementById('register-page');
    const verificationScreen = document.getElementById('verification-screen');
    const verificationEmail = document.getElementById('verification-email');
    
    if (loginPage) loginPage.classList.remove('active');
    if (registerPage) registerPage.classList.remove('active');
    if (verificationScreen) {
        verificationScreen.style.display = 'block';
        verificationScreen.classList.add('active');
    }
    if (verificationEmail) verificationEmail.textContent = email;
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
                
                location.reload();
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


// Отслеживание состояния авторизации
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        
        // Проверяем верификацию email
        if (!user.emailVerified) {
            console.log('Email not verified');
            showVerificationScreen(user.email);
            return;
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
            
            if (verificationScreen) {
                verificationScreen.style.display = 'none';
                verificationScreen.classList.remove('active');
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
        
        if (appContainer) appContainer.classList.remove('active');
        if (verificationScreen) {
            verificationScreen.style.display = 'none';
            verificationScreen.classList.remove('active');
        }
        if (authContainer) authContainer.classList.add('active');
        
        const loginPage = document.getElementById('login-page');
        const registerPage = document.getElementById('register-page');
        if (loginPage) loginPage.classList.add('active');
        if (registerPage) registerPage.classList.remove('active');
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
        const classQuery = query(collection(db, 'classes'), where('members', 'array-contains', userId));
        const classSnapshot = await getDocs(classQuery);
        
        if (!classSnapshot.empty) {
            const classDoc = classSnapshot.docs[0];
            currentClass = {
                id: classDoc.id,
                ...classDoc.data()
            };
            
            const className = document.getElementById('class-name');
            const classCodeDisplay = document.getElementById('class-code-display');
            const currentClassBadge = document.getElementById('current-class-badge');
            
            if (className) className.textContent = currentClass.name;
            if (classCodeDisplay) classCodeDisplay.textContent = `(код: ${currentClass.code})`;
            if (currentClassBadge) currentClassBadge.style.display = 'flex';
            
            console.log('✅ Класс загружен:', currentClass.name, 'ID:', currentClass.id);
            
            await loadHomework();
        } else {
            currentClass = null;
            
            const className = document.getElementById('class-name');
            const classCodeDisplay = document.getElementById('class-code-display');
            const currentClassBadge = document.getElementById('current-class-badge');
            
            if (className) className.textContent = 'Нет класса - создайте или присоединитесь';
            if (classCodeDisplay) classCodeDisplay.textContent = '';
            if (currentClassBadge) currentClassBadge.style.display = 'flex';
            
            const homeworkGrid = document.getElementById('homework-grid');
            if (homeworkGrid) {
                homeworkGrid.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🎓</div>
                        <h3>Вы не в классе</h3>
                        <p>Создайте новый класс или присоединитесь к существующему</p>
                        <button class="btn btn-primary" onclick="document.getElementById('manage-class').click()" style="margin-top: 20px;">
                            <span>Управление классом</span>
                            <div class="btn-glow"></div>
                        </button>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Error loading class:', error);
        showToast('Ошибка загрузки класса', 'error');
    }
}

// Создание класса
const createClassForm = document.getElementById('create-class-form');
if (createClassForm) {
    createClassForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!rateLimiter.canPerform('create_class', 3)) {
            showToast('Слишком много попыток. Подожди минуту.', 'error');
            return;
        }
        
        const className = sanitizeInput(document.getElementById('class-name-input').value, 50);
        
        if (!className) {
            showToast('Введите название класса', 'error');
            return;
        }
        
        const classCode = generateClassCode();
        
        try {
            const classRef = await addDoc(collection(db, 'classes'), {
                name: className,
                code: classCode,
                members: [currentUser.uid],
                createdBy: currentUser.uid,
                createdAt: Timestamp.now()
            });
            
            currentClass = {
                id: classRef.id,
                name: className,
                code: classCode,
                members: [currentUser.uid]
            };
            
            console.log('✅ Класс создан:', currentClass.name, 'ID:', currentClass.id);
            
            const classCodeValue = document.getElementById('class-code-value');
            const generatedCode = document.getElementById('generated-code');
            const classNameEl = document.getElementById('class-name');
            const classCodeDisplay = document.getElementById('class-code-display');
            
            if (classCodeValue) classCodeValue.textContent = classCode;
            if (generatedCode) generatedCode.style.display = 'block';
            if (classNameEl) classNameEl.textContent = className;
            if (classCodeDisplay) classCodeDisplay.textContent = `(код: ${classCode})`;
            
            showToast('Класс создан успешно!', 'success');
            
            await updateClassInfo();
            await loadHomework();
            
        } catch (error) {
            console.error('Error creating class:', error);
            showToast('Ошибка при создании класса', 'error');
        }
    });
}

// Присоединение к классу
const joinClassForm = document.getElementById('join-class-form');
if (joinClassForm) {
    joinClassForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const code = sanitizeInput(document.getElementById('join-code-input').value, 10).toUpperCase();
        
        if (!code) {
            showToast('Введите код класса', 'error');
            return;
        }
        
        await joinClassByCode(currentUser.uid, code);
    });
}

async function joinClassByCode(userId, code) {
    try {
        const classQuery = query(collection(db, 'classes'), where('code', '==', code));
        const classSnapshot = await getDocs(classQuery);
        
        if (classSnapshot.empty) {
            showToast('Класс с таким кодом не найден', 'error');
            return;
        }
        
        const classDoc = classSnapshot.docs[0];
        const classData = classDoc.data();
        
        if (classData.members.includes(userId)) {
            showToast('Вы уже в этом классе', 'info');
            
            currentClass = {
                id: classDoc.id,
                ...classData
            };
            
            const classNameEl = document.getElementById('class-name');
            const classCodeDisplay = document.getElementById('class-code-display');
            
            if (classNameEl) classNameEl.textContent = classData.name;
            if (classCodeDisplay) classCodeDisplay.textContent = `(код: ${classData.code})`;
            
            console.log('✅ Класс установлен:', currentClass.name, 'ID:', currentClass.id);
            
            await loadHomework();
            await updateClassInfo();
            closeModal('class-modal');
            return;
        }
        
        await updateDoc(doc(db, 'classes', classDoc.id), {
            members: arrayUnion(userId)
        });
        
        currentClass = {
            id: classDoc.id,
            ...classData,
            members: [...classData.members, userId]
        };
        
        const classNameEl = document.getElementById('class-name');
        const classCodeDisplay = document.getElementById('class-code-display');
        
        if (classNameEl) classNameEl.textContent = classData.name;
        if (classCodeDisplay) classCodeDisplay.textContent = `(код: ${classData.code})`;
        
        console.log('✅ Присоединились к классу:', currentClass.name, 'ID:', currentClass.id);
        
        showToast('Вы присоединились к классу!', 'success');
        
        await updateClassInfo();
        closeModal('class-modal');
        await loadHomework();
        
    } catch (error) {
        console.error('Error joining class:', error);
        showToast('Ошибка при присоединении к классу', 'error');
    }
}

async function updateClassInfo() {
    if (currentClass) {
        const currentClassInfo = document.getElementById('current-class-info');
        const currentClassNameDisplay = document.getElementById('current-class-name-display');
        const currentClassCodeDisplay = document.getElementById('current-class-code-display');
        const currentClassMembers = document.getElementById('current-class-members');
        
        if (currentClassInfo) currentClassInfo.style.display = 'block';
        if (currentClassNameDisplay) currentClassNameDisplay.textContent = currentClass.name;
        if (currentClassCodeDisplay) currentClassCodeDisplay.textContent = currentClass.code;
        if (currentClassMembers) currentClassMembers.textContent = currentClass.members.length;
    }
}

// Копирование кода класса
const copyCodeBtn = document.getElementById('copy-code-btn');
if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
        const code = document.getElementById('class-code-value')?.textContent;
        if (code) {
            navigator.clipboard.writeText(code).then(() => {
                showToast('Код скопирован!', 'success');
            }).catch(() => {
                showToast('Ошибка при копировании', 'error');
            });
        }
    });
}


// ============================================
// HOMEWORK MANAGEMENT
// ============================================

async function loadHomework() {
    if (!currentClass) {
        console.log('⚠️ Нет класса - показываем пустое состояние');
        const homeworkGrid = document.getElementById('homework-grid');
        if (homeworkGrid) {
            homeworkGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📚</div>
                    <h3>Выберите класс</h3>
                    <p>Присоединитесь к классу или создайте новый</p>
                </div>
            `;
        }
        return;
    }
    
    console.log('🔄 Загружаем ДЗ для класса:', currentClass.name, 'ID:', currentClass.id);
    
    try {
        if (homeworkUnsubscribe) {
            homeworkUnsubscribe();
        }
        
        const homeworkQuery = query(
            collection(db, 'homework'),
            where('classId', '==', currentClass.id)
        );
        
        homeworkUnsubscribe = onSnapshot(homeworkQuery, (snapshot) => {
            currentHomeworkData = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                currentHomeworkData.push({
                    id: doc.id,
                    ...data
                });
            });
            
            console.log(`✅ Загружено ${currentHomeworkData.length} заданий для класса ${currentClass.name}`);
            
            currentHomeworkData.sort((a, b) => {
                return a.deadline.toDate() - b.deadline.toDate();
            });
            
            renderHomework();
        }, (error) => {
            console.error('❌ Error in homework snapshot:', error);
            showToast('Ошибка загрузки заданий', 'error');
        });
        
    } catch (error) {
        console.error('❌ Error loading homework:', error);
        showToast('Ошибка загрузки заданий', 'error');
    }
}

function renderHomework(filter = 'all') {
    const container = document.getElementById('homework-grid');
    if (!container) return;
    
    if (currentHomeworkData.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <h3>Нет заданий</h3>
                <p>Добавьте первое домашнее задание!</p>
            </div>
        `;
        return;
    }
    
    let filteredHomework = currentHomeworkData;
    const now = new Date();
    
    if (filter === 'pending') {
        const userDocRef = doc(db, 'users', currentUser.uid);
        getDoc(userDocRef).then(docSnapshot => {
            const completedIds = docSnapshot.data()?.completedHomework || [];
            filteredHomework = currentHomeworkData.filter(hw => !completedIds.includes(hw.id));
            displayHomeworkCards(filteredHomework);
        }).catch(error => {
            console.error('Error filtering pending homework:', error);
            displayHomeworkCards(currentHomeworkData);
        });
        return;
    } else if (filter === 'urgent') {
        const urgentTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        filteredHomework = currentHomeworkData.filter(hw => {
            const deadline = hw.deadline.toDate();
            return deadline <= urgentTime && deadline >= now;
        });
    }
    
    displayHomeworkCards(filteredHomework);
}

function displayHomeworkCards(homeworkList) {
    const container = document.getElementById('homework-grid');
    if (!container) return;
    
    const now = new Date();
    
    container.innerHTML = homeworkList.map(hw => {
        const deadline = hw.deadline.toDate();
        const isUrgent = deadline <= new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const isPast = deadline < now;
        
        return `
            <div class="homework-card ${isUrgent && !isPast ? 'urgent' : ''}" data-id="${hw.id}">
                <div class="card-header">
                    <span class="subject-tag">${sanitizeInput(hw.subject, 50)}</span>
                    ${isUrgent && !isPast ? '<span class="urgent-badge">Срочно</span>' : ''}
                </div>
                <p class="card-description">${sanitizeInput(hw.description, 200)}</p>
                <div class="card-footer">
                    <div class="deadline ${isUrgent ? 'urgent' : ''}">
                        🕐 ${formatDate(deadline)}
                    </div>
                    <div class="author-info">
                        👤 ${sanitizeInput(hw.authorName || 'Аноним', 50)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    document.querySelectorAll('.homework-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            showHomeworkDetail(id);
        });
    });
}

// Добавление домашнего задания
const addHomeworkForm = document.getElementById('add-homework-form');
if (addHomeworkForm) {
    addHomeworkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentClass) {
            showToast('Сначала выберите класс', 'error');
            return;
        }
        
        if (!rateLimiter.canPerform('add_homework', 3)) {
            showToast('Слишком много попыток. Подожди минуту.', 'error');
            return;
        }
        
        const subject = sanitizeInput(document.getElementById('hw-subject').value, 100);
        const description = sanitizeInput(document.getElementById('hw-description').value, 1000);
        const deadlineValue = document.getElementById('hw-deadline').value;
        
        if (!subject || !description || !deadlineValue) {
            showToast('Заполните все поля', 'error');
            return;
        }
        
        if (isSpam(description)) {
            showToast('Обнаружен спам. Напиши нормальное описание.', 'error');
            return;
        }
        
        const deadline = new Date(deadlineValue);
        const now = new Date();
        const maxFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        
        if (deadline < now) {
            showToast('Дедлайн не может быть в прошлом', 'error');
            return;
        }
        
        if (deadline > maxFuture) {
            showToast('Дедлайн слишком далеко в будущем', 'error');
            return;
        }
        
        try {
            const newHomework = {
                classId: currentClass.id,
                subject: subject,
                description: description,
                deadline: Timestamp.fromDate(deadline),
                authorId: currentUser.uid,
                authorName: currentUser.displayName || 'Аноним',
                proofs: [],
                createdAt: Timestamp.now()
            };
            
            await addDoc(collection(db, 'homework'), newHomework);
            
            showToast('Домашнее задание добавлено!', 'success');
            closeModal('add-homework-modal');
            addHomeworkForm.reset();
            
            await sendNotificationToClass(
                currentClass.id,
                'Новое задание',
                `${currentUser.displayName || 'Кто-то'} добавил задание по ${subject}`
            );
            
        } catch (error) {
            console.error('Error adding homework:', error);
            showToast('Ошибка при добавлении задания', 'error');
        }
    });
}

// Показать детали задания
async function showHomeworkDetail(homeworkId) {
    const homework = currentHomeworkData.find(hw => hw.id === homeworkId);
    if (!homework) return;
    
    try {
        const detailSubject = document.getElementById('detail-subject');
        const detailDescription = document.getElementById('detail-description');
        const detailDeadline = document.getElementById('detail-deadline');
        const detailAuthor = document.getElementById('detail-author');
        
        if (detailSubject) detailSubject.textContent = homework.subject;
        if (detailDescription) detailDescription.textContent = homework.description;
        if (detailDeadline) detailDeadline.textContent = formatDate(homework.deadline.toDate());
        if (detailAuthor) detailAuthor.textContent = homework.authorName || 'Аноним';
        
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const completedHomework = userDoc.data()?.completedHomework || [];
        const isCompleted = completedHomework.includes(homeworkId);
        
        const userProof = homework.proofs?.find(p => p.userId === currentUser.uid);
        
        const proofUploadArea = document.getElementById('proof-upload-area');
        const proofPreview = document.getElementById('proof-preview');
        const proofImage = document.getElementById('proof-image');
        
        if (userProof) {
            if (proofUploadArea) proofUploadArea.style.display = 'none';
            if (proofPreview) proofPreview.style.display = 'block';
            if (proofImage) proofImage.src = userProof.imageUrl;
        } else {
            if (proofUploadArea) proofUploadArea.style.display = 'block';
            if (proofPreview) proofPreview.style.display = 'none';
        }
        
        const proofsSection = document.getElementById('proofs-section');
        if (userProof) {
            const otherProofs = homework.proofs?.filter(p => p.userId !== currentUser.uid) || [];
            if (proofsSection) proofsSection.style.display = 'block';
            renderOtherProofs(otherProofs, homeworkId);
        } else {
            if (proofsSection) proofsSection.style.display = 'none';
        }
        
        const completeBtn = document.getElementById('mark-complete-btn');
        if (completeBtn) {
            if (isCompleted) {
                completeBtn.innerHTML = '<span>✓ Выполнено</span>';
                completeBtn.disabled = true;
                completeBtn.style.opacity = '0.6';
            } else {
                completeBtn.innerHTML = '<span>✓ Отметить выполненным (+1 балл)</span><div class="btn-glow"></div>';
                completeBtn.disabled = !userProof;
                completeBtn.style.opacity = userProof ? '1' : '0.6';
                completeBtn.onclick = () => markHomeworkComplete(homeworkId);
            }
        }
        
        const modal = document.getElementById('homework-detail-modal');
        if (modal) modal.dataset.homeworkId = homeworkId;
        
        openModal('homework-detail-modal');
        
    } catch (error) {
        console.error('Error showing homework detail:', error);
        showToast('Ошибка загрузки деталей задания', 'error');
    }
}

// Загрузка доказательства
const uploadProofBtn = document.getElementById('upload-proof-btn');
if (uploadProofBtn) {
    uploadProofBtn.addEventListener('click', () => {
        const proofFile = document.getElementById('proof-file');
        if (proofFile) proofFile.click();
    });
}

const proofFileInput = document.getElementById('proof-file');
if (proofFileInput) {
    proofFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!rateLimiter.canPerform('upload_proof', 5)) {
            showToast('Слишком много попыток. Подожди минуту.', 'error');
            e.target.value = '';
            return;
        }
        
        const modal = document.getElementById('homework-detail-modal');
        const homeworkId = modal?.dataset.homeworkId;
        
        if (!homeworkId) {
            showToast('Ошибка: не найдено ID задания', 'error');
            e.target.value = '';
            return;
        }
        
        try {
            showToast('Обработка изображения...', 'info');
            
            const base64 = await validateAndCompressImage(file);
            
            const homeworkRef = doc(db, 'homework', homeworkId);
            await updateDoc(homeworkRef, {
                proofs: arrayUnion({
                    userId: currentUser.uid,
                    userName: currentUser.displayName || 'Аноним',
                    imageUrl: base64,
                    uploadedAt: Timestamp.now(),
                    votes: []
                })
            });
            
            showToast('Доказательство загружено!', 'success');
            e.target.value = '';
            await showHomeworkDetail(homeworkId);
            
        } catch (error) {
            console.error('Error uploading proof:', error);
            showToast(error.message || 'Ошибка при загрузке доказательства', 'error');
            e.target.value = '';
        }
    });
}

// Удаление доказательства
const removeProofBtn = document.getElementById('remove-proof-btn');
if (removeProofBtn) {
    removeProofBtn.addEventListener('click', async () => {
        const modal = document.getElementById('homework-detail-modal');
        const homeworkId = modal?.dataset.homeworkId;
        
        if (!homeworkId) return;
        
        const homework = currentHomeworkData.find(hw => hw.id === homeworkId);
        if (!homework) return;
        
        const userProof = homework.proofs?.find(p => p.userId === currentUser.uid);
        if (!userProof) return;
        
        try {
            const homeworkRef = doc(db, 'homework', homeworkId);
            await updateDoc(homeworkRef, {
                proofs: arrayRemove(userProof)
            });
            
            showToast('Доказательство удалено', 'info');
            await showHomeworkDetail(homeworkId);
            
        } catch (error) {
            console.error('Error removing proof:', error);
            showToast('Ошибка при удалении доказательства', 'error');
        }
    });
}

// Отображение доказательств других учеников
function renderOtherProofs(proofs, homeworkId) {
    const container = document.getElementById('other-proofs-grid');
    if (!container) return;
    
    if (proofs.length === 0) {
        container.innerHTML = '<p class="info-text">Пока никто не загрузил доказательства</p>';
        return;
    }
    
    container.innerHTML = proofs.map(proof => `
        <div class="proof-item">
            <img src="${proof.imageUrl}" alt="Доказательство ${sanitizeInput(proof.userName, 50)}">
            <div class="proof-overlay">
                <span class="proof-author">${sanitizeInput(proof.userName, 50)}</span>
                <div class="proof-actions">
                    <button onclick="voteProof('${homeworkId}', '${proof.userId}', false)" title="Это фейк">
                        👎 ${proof.votes?.filter(v => !v.isValid).length || 0}
                    </button>
                    <button onclick="reportProof('${homeworkId}', '${proof.userId}')" title="Пожаловаться">
                        🚩
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// Голосование за доказательство
window.voteProof = async function(homeworkId, proofUserId, isValid) {
    try {
        const homework = currentHomeworkData.find(hw => hw.id === homeworkId);
        if (!homework) {
            showToast('Задание не найдено', 'error');
            return;
        }
        
        const proof = homework.proofs.find(p => p.userId === proofUserId);
        if (!proof) {
            showToast('Доказательство не найдено', 'error');
            return;
        }
        
        const existingVote = proof.votes?.find(v => v.voterId === currentUser.uid);
        if (existingVote) {
            showToast('Вы уже голосовали', 'info');
            return;
        }
        
        const updatedProof = {
            ...proof,
            votes: [...(proof.votes || []), { voterId: currentUser.uid, isValid }]
        };
        
        const fakeVotes = updatedProof.votes.filter(v => !v.isValid).length;
        
        if (fakeVotes >= 5) {
            const homeworkRef = doc(db, 'homework', homeworkId);
            await updateDoc(homeworkRef, {
                proofs: arrayRemove(proof)
            });
            showToast('Доказательство удалено из-за голосования', 'info');
        } else {
            const homeworkRef = doc(db, 'homework', homeworkId);
            const allProofs = homework.proofs.map(p => 
                p.userId === proofUserId ? updatedProof : p
            );
            await updateDoc(homeworkRef, { proofs: allProofs });
            showToast('Голос учтен', 'success');
        }
        
        await showHomeworkDetail(homeworkId);
        
    } catch (error) {
        console.error('Error voting:', error);
        showToast('Ошибка при голосовании', 'error');
    }
};

// Жалоба на доказательство
window.reportProof = function(homeworkId, proofUserId) {
    const modal = document.getElementById('report-modal');
    if (modal) {
        modal.dataset.homeworkId = homeworkId;
        modal.dataset.proofUserId = proofUserId;
        openModal('report-modal');
    }
};

const reportForm = document.getElementById('report-form');
if (reportForm) {
    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const modal = document.getElementById('report-modal');
        const homeworkId = modal?.dataset.homeworkId;
        const proofUserId = modal?.dataset.proofUserId;
        const reason = sanitizeInput(document.getElementById('report-reason')?.value, 500);
        
        if (!homeworkId || !proofUserId || !reason) {
            showToast('Заполните причину жалобы', 'error');
            return;
        }
        
        try {
            await addDoc(collection(db, 'reports'), {
                homeworkId: homeworkId,
                proofUserId: proofUserId,
                reporterId: currentUser.uid,
                reporterName: currentUser.displayName || 'Аноним',
                reason: reason,
                createdAt: Timestamp.now(),
                status: 'pending'
            });
            
            showToast('Жалоба отправлена модератору', 'success');
            closeModal('report-modal');
            reportForm.reset();
            
        } catch (error) {
            console.error('Error reporting:', error);
            showToast('Ошибка при отправке жалобы', 'error');
        }
    });
}

// Отметить задание как выполненное
async function markHomeworkComplete(homeworkId) {
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        
        await updateDoc(userRef, {
            completedHomework: arrayUnion(homeworkId),
            points: increment(1)
        });
        
        showToast('Задание выполнено! +1 балл', 'success');
        
        const userDoc = await getDoc(userRef);
        const userData = userDoc.data();
        
        const userPoints = document.getElementById('user-points');
        const completedCount = document.getElementById('completed-count');
        
        if (userPoints) userPoints.textContent = userData.points;
        if (completedCount) completedCount.textContent = userData.completedHomework.length;
        
        closeModal('homework-detail-modal');
        
    } catch (error) {
        console.error('Error marking complete:', error);
        showToast('Ошибка при отметке задания', 'error');
    }
}


// ============================================
// CALENDAR VIEW
// ============================================

function generateCalendar() {
    const container = document.getElementById('calendar-container');
    if (!container) return;
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDay = firstDay.getDay();
    
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                       'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    
    let html = `
        <div class="calendar-header">
            <h2 class="calendar-title">${monthNames[month]} ${year}</h2>
            <div class="calendar-nav">
                <button class="btn btn-secondary" onclick="changeMonth(-1)">←</button>
                <button class="btn btn-secondary" onclick="changeMonth(1)">→</button>
            </div>
        </div>
        <div class="calendar-grid">
            <div class="calendar-day-header">Вс</div>
            <div class="calendar-day-header">Пн</div>
            <div class="calendar-day-header">Вт</div>
            <div class="calendar-day-header">Ср</div>
            <div class="calendar-day-header">Чт</div>
            <div class="calendar-day-header">Пт</div>
            <div class="calendar-day-header">Сб</div>
    `;
    
    for (let i = 0; i < startDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const isToday = date.toDateString() === now.toDateString();
        
        const homeworkCount = currentHomeworkData.filter(hw => {
            const deadline = hw.deadline.toDate();
            return deadline.toDateString() === date.toDateString();
        }).length;
        
        const hasHomework = homeworkCount > 0;
        
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${hasHomework ? 'has-homework' : ''}">
                <span>${day}</span>
                ${hasHomework ? `<span class="homework-count">${homeworkCount}</span>` : ''}
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;
}

window.changeMonth = function(direction) {
    showToast('Функция в разработке', 'info');
};

// ============================================
// LEADERBOARD
// ============================================

async function loadLeaderboard(scope = 'class') {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;
    
    try {
        let usersQuery;
        
        if (scope === 'class' && currentClass) {
            if (currentClass.members.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🏆</div>
                        <h3>Нет участников</h3>
                        <p>В классе пока нет участников</p>
                    </div>
                `;
                return;
            }
            
            usersQuery = query(
                collection(db, 'users'),
                where('__name__', 'in', currentClass.members)
            );
        } else {
            usersQuery = query(collection(db, 'users'));
        }
        
        const snapshot = await getDocs(usersQuery);
        const users = [];
        
        snapshot.forEach(docSnapshot => {
            const data = docSnapshot.data();
            users.push({
                id: docSnapshot.id,
                name: data.name || 'Аноним',
                points: data.points || 0,
                completedCount: data.completedHomework?.length || 0
            });
        });
        
        users.sort((a, b) => b.points - a.points);
        
        const displayUsers = scope === 'global' ? users.slice(0, 50) : users;
        
        if (displayUsers.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🏆</div>
                    <h3>Нет данных</h3>
                    <p>Пока нет участников для отображения</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = displayUsers.map((user, index) => {
            const rank = index + 1;
            let rankClass = '';
            if (rank === 1) rankClass = 'gold';
            else if (rank === 2) rankClass = 'silver';
            else if (rank === 3) rankClass = 'bronze';
            
            return `
                <div class="leaderboard-item ${rank <= 3 ? 'top-3' : ''}">
                    <div class="rank ${rankClass}">#${rank}</div>
                    <div class="player-info">
                        <div class="player-name">${sanitizeInput(user.name, 50)}</div>
                        <div class="player-class">${user.completedCount} заданий выполнено</div>
                    </div>
                    <div class="player-score">${user.points}</div>
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
    const container = document.getElementById('completed-grid');
    if (!container) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const completedIds = userDoc.data()?.completedHomework || [];
        
        if (completedIds.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">✅</div>
                    <h3>Нет выполненных заданий</h3>
                    <p>Выполни свое первое задание!</p>
                </div>
            `;
            return;
        }
        
        const completedHomework = currentHomeworkData.filter(hw => completedIds.includes(hw.id));
        
        displayHomeworkCards(completedHomework);
        
    } catch (error) {
        console.error('Error loading completed homework:', error);
        showToast('Ошибка загрузки выполненных заданий', 'error');
    }
}

// ============================================
// NOTIFICATIONS
// ============================================

async function sendNotificationToClass(classId, title, message) {
    try {
        const classDoc = await getDoc(doc(db, 'classes', classId));
        if (!classDoc.exists()) {
            console.error('Class not found');
            return;
        }
        
        const members = classDoc.data().members;
        
        const notifications = members.map(memberId => {
            return addDoc(collection(db, 'notifications'), {
                userId: memberId,
                title: title,
                message: message,
                read: false,
                createdAt: Timestamp.now()
            });
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