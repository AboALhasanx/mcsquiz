/**
 * Master Studio Native IndexedDB Client Storage Engine (QuizVault)
 * ---------------------------------------------------------------
 * High-performance, zero-dependency, asynchronous storage for quizzes,
 * in-progress session states, bookmarked questions, and offline submission queues.
 *
 * Database Name: MasterStudioQuizDB
 * Version: 1
 *
 * Object Stores:
 *   1. quizzes           (keyPath: key = `${subject_id}/${quiz_id}`)
 *   2. in_progress       (keyPath: key = `${subject_id}/${quiz_id}`)
 *   3. bookmarks         (keyPath: k   = `${subject_id}/${quiz_id}#${index}`)
 *   4. submission_queue  (keyPath: submission_uuid)
 */

(function (global) {
    'use strict';

    const DB_NAME = 'MasterStudioQuizDB';
    const DB_VERSION = 1;

    const SUBJECT_METADATA = {
        '01_Cyber_Security': { title: 'الأمن السيبراني', instructor_ar: 'أ.م.د. هدى لفتة مجيد', semester: 1 },
        '02_English_Language': { title: 'اللغة الإنجليزية', instructor_ar: 'أ.م.د. حيدر عكاب علوان', semester: 1 },
        '03_Data_Mining': { title: 'تنقيب البيانات', instructor_ar: 'أ.م.د. أحمد شاكر عبد الرضا', semester: 1 },
        '04_Advanced_Software_Eng': { title: 'هندسة البرمجيات المتقدمة', instructor_ar: 'أ.م.د. علي فاهم نعمة', semester: 1 },
        '05_Soft_Computing': { title: 'الحوسبة المرنة', instructor_ar: 'أ.د. عبد الهادي محمد ادخيل', semester: 1 },
        '06_Artificial_Intelligence': { title: 'الذكاء الاصطناعي', instructor_ar: 'أ.د. سيف علي السعيدي', semester: 1 }
    };

    /**
     * Client-side schema normalizer ensuring Canonical Schema v2 invariants.
     */
    function normalizeClientQuiz(raw, subjectFallback, quizIdFallback) {
        if (!raw || typeof raw !== 'object') return null;

        const letters = ['A', 'B', 'C', 'D'];
        const subj = raw.subject_id || raw.subject || subjectFallback || '00_STUDIO_HUB';
        const meta = SUBJECT_METADATA[subj] || {};

        const sem = Number.isInteger(raw.semester) ? raw.semester : (meta.semester || 1);
        const qid = raw.quiz_id || quizIdFallback || (raw.topic ? String(raw.topic).replace(/\s+/g, '_') : 'Quiz_01');

        const normalized = {
            schema_version: 2,
            key: `${subj}/${qid}`,
            subject_id: subj,
            subject: subj,
            subject_title: raw.subject_title || meta.title || subj.replace(/_/g, ' '),
            semester: sem,
            semester_label: raw.semester_label || (sem === 1 ? 'كورس أول' : 'كورس ثاني'),
            quiz_id: qid,
            topic: raw.topic || qid,
            instructor_ar: raw.instructor_ar || meta.instructor_ar || raw.instructor || '',
            instructor: raw.instructor || raw.instructor_ar || meta.instructor_ar || '',
            source: raw.source || '',
            questions: []
        };

        const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
        normalized.questions = rawQuestions.map((q, idx) => {
            if (!q || typeof q !== 'object') return null;

            const qNum = idx + 1;
            const qId = q.id || `q${qNum}`;
            const conceptId = q.concept_id || `concept_${qNum}`;
            const bloom = q.bloom_level ? String(q.bloom_level).trim() : 'Understand';

            // Prompts
            const qEn = q.question || q.text_en || q.text || q.question_ar || '';
            const qAr = q.question_ar || q.text || q.question || '';

            // Options normalization
            let opts = [];
            if (Array.isArray(q.options)) {
                opts = q.options.map(String);
            } else if (q.options && typeof q.options === 'object') {
                opts = letters.map(l => String(q.options[l] || ''));
            }
            while (opts.length < 4) opts.push('');
            opts = opts.slice(0, 4);

            // Answer & Correct index
            let corr = 0;
            let ans = 'A';
            if (typeof q.answer === 'string' && letters.includes(q.answer.toUpperCase())) {
                ans = q.answer.toUpperCase();
                corr = letters.indexOf(ans);
            } else if (Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4) {
                corr = q.correct;
                ans = letters[corr];
            } else if (Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4) {
                corr = q.answer;
                ans = letters[corr];
            }

            // Options AR
            let optsAr = [];
            if (Array.isArray(q.options_ar)) {
                optsAr = q.options_ar.map(String);
            } else if (q.options_ar && typeof q.options_ar === 'object') {
                optsAr = letters.map(l => String(q.options_ar[l] || ''));
            } else {
                optsAr = [...opts];
            }
            while (optsAr.length < 4) optsAr.push('');
            optsAr = optsAr.slice(0, 4);

            // Options EN
            let optsEn = [];
            if (Array.isArray(q.options_en)) {
                optsEn = q.options_en.map(String);
            } else if (q.options_en && typeof q.options_en === 'object') {
                optsEn = letters.map(l => String(q.options_en[l] || ''));
            } else {
                optsEn = [...opts];
            }
            while (optsEn.length < 4) optsEn.push('');
            optsEn = optsEn.slice(0, 4);

            return {
                id: qId,
                concept_id: conceptId,
                bloom_level: bloom,
                question: qEn,
                question_ar: qAr,
                options: opts,
                options_ar: optsAr,
                options_en: optsEn,
                answer: ans,
                correct: corr,
                explanation: q.explanation || ''
            };
        }).filter(Boolean);

        return normalized;
    }

    class QuizVault {
        constructor() {
            this.db = null;
            this.isInitialized = false;
            this.useFallback = false;
            this.initPromise = null;
        }

        /**
         * Initialize the IndexedDB database and request storage durability.
         */
        async init() {
            if (this.initPromise) return this.initPromise;

            this.initPromise = new Promise((resolve) => {
                // Request OS persistent storage quota if available
                if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
                    navigator.storage.persist().then(persistent => {
                        if (persistent) {
                            console.log('📦 MasterStudio QuizVault: Storage granted persistence.');
                        }
                    }).catch(() => {});
                }

                if (typeof window === 'undefined' || !window.indexedDB) {
                    console.warn('⚠️ MasterStudio QuizVault: IndexedDB not available, using localStorage fallback.');
                    this.useFallback = true;
                    this.isInitialized = true;
                    return resolve();
                }

                try {
                    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;

                        // 1. Quizzes Store
                        if (!db.objectStoreNames.contains('quizzes')) {
                            const qStore = db.createObjectStore('quizzes', { keyPath: 'key' });
                            qStore.createIndex('by_subject', 'subject_id', { unique: false });
                            qStore.createIndex('by_semester', 'semester', { unique: false });
                        }

                        // 2. In-Progress Sessions Store
                        if (!db.objectStoreNames.contains('in_progress')) {
                            db.createObjectStore('in_progress', { keyPath: 'key' });
                        }

                        // 3. Bookmarks Store
                        if (!db.objectStoreNames.contains('bookmarks')) {
                            const bStore = db.createObjectStore('bookmarks', { keyPath: 'k' });
                            bStore.createIndex('by_subject', 'subject', { unique: false });
                        }

                        // 4. Offline Submission Queue Store
                        if (!db.objectStoreNames.contains('submission_queue')) {
                            const sStore = db.createObjectStore('submission_queue', { keyPath: 'submission_uuid' });
                            sStore.createIndex('by_status', 'status', { unique: false });
                        }
                    };

                    req.onsuccess = (e) => {
                        this.db = e.target.result;
                        this.isInitialized = true;
                        this.useFallback = false;
                        resolve();
                    };

                    req.onerror = (e) => {
                        console.warn('⚠️ MasterStudio QuizVault: Open failed, using localStorage fallback:', e.target.error);
                        this.useFallback = true;
                        this.isInitialized = true;
                        resolve();
                    };
                } catch (err) {
                    console.warn('⚠️ MasterStudio QuizVault: Exception during init:', err);
                    this.useFallback = true;
                    this.isInitialized = true;
                    resolve();
                }
            });

            return this.initPromise;
        }

        // =========================================================================
        // 1. Quizzes Catalog Operations
        // =========================================================================

        /**
         * Save or update a normalized quiz in the vault.
         */
        async putQuiz(quizData) {
            await this.init();
            const normalized = normalizeClientQuiz(quizData);
            if (!normalized) throw new Error('Invalid quiz data');

            if (this.useFallback) {
                try {
                    localStorage.setItem(`ms_vault_quiz_${normalized.key}`, JSON.stringify(normalized));
                    // Keep track of keys
                    const keys = JSON.parse(localStorage.getItem('ms_vault_quiz_keys') || '[]');
                    if (!keys.includes(normalized.key)) {
                        keys.push(normalized.key);
                        localStorage.setItem('ms_vault_quiz_keys', JSON.stringify(keys));
                    }
                } catch (e) {
                    console.warn('QuizVault localStorage put failed:', e);
                }
                return normalized;
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('quizzes', 'readwrite');
                const store = tx.objectStore('quizzes');
                const req = store.put(normalized);
                req.onsuccess = () => resolve(normalized);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Retrieve a single quiz by subject and quiz ID.
         */
        async getQuiz(subjectId, quizId) {
            await this.init();
            const cleanQuizId = quizId.endsWith('.json') ? quizId.slice(0, -5) : quizId;
            const key = `${subjectId}/${cleanQuizId}`;

            if (this.useFallback) {
                try {
                    const raw = localStorage.getItem(`ms_vault_quiz_${key}`);
                    return raw ? JSON.parse(raw) : null;
                } catch (e) {
                    return null;
                }
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('quizzes', 'readonly');
                const store = tx.objectStore('quizzes');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Retrieve all stored quizzes, optionally filtered by subject.
         */
        async getAllQuizzes(subjectFilter) {
            await this.init();

            if (this.useFallback) {
                try {
                    const keys = JSON.parse(localStorage.getItem('ms_vault_quiz_keys') || '[]');
                    const results = [];
                    for (const k of keys) {
                        const raw = localStorage.getItem(`ms_vault_quiz_${k}`);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            if (!subjectFilter || parsed.subject_id === subjectFilter) {
                                results.push(parsed);
                            }
                        }
                    }
                    return results;
                } catch (e) {
                    return [];
                }
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('quizzes', 'readonly');
                const store = tx.objectStore('quizzes');
                let req;
                if (subjectFilter) {
                    const index = store.index('by_subject');
                    req = index.getAll(subjectFilter);
                } else {
                    req = store.getAll();
                }
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Import a full Curriculum Bundle JSON object.
         */
        async importBundle(bundleJson) {
            await this.init();
            if (!bundleJson || typeof bundleJson !== 'object') {
                return { imported: 0, errors: ['Invalid bundle object'] };
            }

            const quizzes = Array.isArray(bundleJson.quizzes) ? bundleJson.quizzes : [];
            let imported = 0;
            const errors = [];

            for (const q of quizzes) {
                try {
                    const normalized = normalizeClientQuiz(q);
                    if (normalized && normalized.questions.length > 0) {
                        await this.putQuiz(normalized);
                        imported++;
                    } else {
                        errors.push(`Quiz ${(q && q.quiz_id) || 'unknown'} has no valid questions.`);
                    }
                } catch (err) {
                    errors.push(`Failed to import ${(q && q.quiz_id) || 'quiz'}: ${err.message}`);
                }
            }

            return { imported, errors };
        }

        // =========================================================================
        // 2. In-Progress Session State Operations
        // =========================================================================

        /**
         * Save in-progress session state for a quiz.
         */
        async saveProgress(subjectId, quizId, state) {
            await this.init();
            const cleanQuizId = quizId.endsWith('.json') ? quizId.slice(0, -5) : quizId;
            const key = `${subjectId}/${cleanQuizId}`;
            const record = {
                key,
                currentIndex: state.currentIndex || 0,
                answers: state.answers || {},
                dwellTimes: state.dwellTimes || {},
                answerTimestamps: state.answerTimestamps || {},
                reflections: state.reflections || {},
                luckyGuesses: state.luckyGuesses || {},
                updatedAt: new Date().toISOString()
            };

            if (this.useFallback) {
                try {
                    localStorage.setItem(`ms_vault_progress_${key}`, JSON.stringify(record));
                } catch (e) {}
                return;
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('in_progress', 'readwrite');
                const store = tx.objectStore('in_progress');
                const req = store.put(record);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Retrieve in-progress session state.
         */
        async getProgress(subjectId, quizId) {
            await this.init();
            const cleanQuizId = quizId.endsWith('.json') ? quizId.slice(0, -5) : quizId;
            const key = `${subjectId}/${cleanQuizId}`;

            if (this.useFallback) {
                try {
                    const raw = localStorage.getItem(`ms_vault_progress_${key}`);
                    return raw ? JSON.parse(raw) : null;
                } catch (e) {
                    return null;
                }
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('in_progress', 'readonly');
                const store = tx.objectStore('in_progress');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Clear in-progress session state upon completion.
         */
        async clearProgress(subjectId, quizId) {
            await this.init();
            const cleanQuizId = quizId.endsWith('.json') ? quizId.slice(0, -5) : quizId;
            const key = `${subjectId}/${cleanQuizId}`;

            if (this.useFallback) {
                try {
                    localStorage.removeItem(`ms_vault_progress_${key}`);
                } catch (e) {}
                return;
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('in_progress', 'readwrite');
                const store = tx.objectStore('in_progress');
                const req = store.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        // =========================================================================
        // 3. Bookmarks Operations
        // =========================================================================

        /**
         * Save a bookmarked question.
         */
        async saveBookmark(meta) {
            await this.init();
            if (!meta || !meta.k) throw new Error('Bookmark metadata requires key "k"');
            const record = {
                k: meta.k,
                subject: meta.subject || '',
                subject_title: meta.subject_title || '',
                quiz: meta.quiz || '',
                n: meta.n || 0,
                question_data: meta.question_data || null,
                ts: meta.ts || new Date().toISOString()
            };

            if (this.useFallback) {
                try {
                    const list = JSON.parse(localStorage.getItem('ms_vault_bookmarks') || '[]');
                    const idx = list.findIndex(b => b.k === record.k);
                    if (idx >= 0) list[idx] = record;
                    else list.push(record);
                    localStorage.setItem('ms_vault_bookmarks', JSON.stringify(list));
                } catch (e) {}
                return;
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('bookmarks', 'readwrite');
                const store = tx.objectStore('bookmarks');
                const req = store.put(record);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Remove a bookmarked question by key.
         */
        async removeBookmark(key) {
            await this.init();
            if (this.useFallback) {
                try {
                    const list = JSON.parse(localStorage.getItem('ms_vault_bookmarks') || '[]');
                    const filtered = list.filter(b => b.k !== key);
                    localStorage.setItem('ms_vault_bookmarks', JSON.stringify(filtered));
                } catch (e) {}
                return;
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('bookmarks', 'readwrite');
                const store = tx.objectStore('bookmarks');
                const req = store.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Retrieve all bookmarked questions.
         */
        async getAllBookmarks(subjectFilter) {
            await this.init();
            if (this.useFallback) {
                try {
                    const list = JSON.parse(localStorage.getItem('ms_vault_bookmarks') || '[]');
                    if (!subjectFilter) return list;
                    return list.filter(b => b.subject === subjectFilter);
                } catch (e) {
                    return [];
                }
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('bookmarks', 'readonly');
                const store = tx.objectStore('bookmarks');
                let req;
                if (subjectFilter) {
                    const index = store.index('by_subject');
                    req = index.getAll(subjectFilter);
                } else {
                    req = store.getAll();
                }
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        }

        // =========================================================================
        // 4. Offline Submission Queue Operations
        // =========================================================================

        /**
         * Enqueue a submission telemetry payload. Returns submission_uuid.
         */
        async enqueueSubmission(payload) {
            await this.init();
            const uuid = payload.submission_uuid || (
                typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            );

            const record = {
                submission_uuid: uuid,
                payload: Object.assign({}, payload, { submission_uuid: uuid }),
                queued_at: new Date().toISOString(),
                status: 'pending'
            };

            if (this.useFallback) {
                try {
                    const queue = JSON.parse(localStorage.getItem('ms_vault_submission_queue') || '[]');
                    queue.push(record);
                    localStorage.setItem('ms_vault_submission_queue', JSON.stringify(queue));
                } catch (e) {}
                return uuid;
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('submission_queue', 'readwrite');
                const store = tx.objectStore('submission_queue');
                const req = store.put(record);
                req.onsuccess = () => resolve(uuid);
                req.onerror = () => reject(req.error);
            });
        }

        /**
         * Get all pending submissions waiting to be synced to the server.
         */
        async getPendingSubmissions() {
            await this.init();
            if (this.useFallback) {
                try {
                    const queue = JSON.parse(localStorage.getItem('ms_vault_submission_queue') || '[]');
                    return queue.filter(item => item.status === 'pending');
                } catch (e) {
                    return [];
                }
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('submission_queue', 'readonly');
                const store = tx.objectStore('submission_queue');
                const index = store.index('by_status');
                const req = index.getAll('pending');
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => {
                    // Fallback to full scan if index fails
                    const fullReq = store.getAll();
                    fullReq.onsuccess = () => {
                        const items = (fullReq.result || []).filter(item => item.status === 'pending');
                        resolve(items);
                    };
                    fullReq.onerror = () => reject(fullReq.error);
                };
            });
        }

        /**
         * Dequeue/remove a successfully synchronized submission.
         */
        async dequeueSubmission(submissionUuid) {
            await this.init();
            if (!submissionUuid) return;

            if (this.useFallback) {
                try {
                    const queue = JSON.parse(localStorage.getItem('ms_vault_submission_queue') || '[]');
                    const filtered = queue.filter(item => item.submission_uuid !== submissionUuid);
                    localStorage.setItem('ms_vault_submission_queue', JSON.stringify(filtered));
                } catch (e) {}
                return;
            }

            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('submission_queue', 'readwrite');
                const store = tx.objectStore('submission_queue');
                const req = store.delete(submissionUuid);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }
    }

    // Expose client normalizer helper
    QuizVault.normalizeClientQuiz = normalizeClientQuiz;

    // Singleton instance
    const quizVaultInstance = new QuizVault();

    if (typeof window !== 'undefined') {
        window.QuizVault = QuizVault;
        window.quizVault = quizVaultInstance;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { QuizVault, quizVault: quizVaultInstance, normalizeClientQuiz };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
