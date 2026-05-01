const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
const db = new Database('school.db');

// Create all tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        student_id TEXT UNIQUE,
        grade TEXT,
        section TEXT,
        parent_name TEXT,
        parent_phone TEXT,
        address TEXT,
        enrollment_date TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        employee_id TEXT UNIQUE,
        qualification TEXT,
        subjects TEXT,
        phone TEXT,
        hire_date TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT,
        date TEXT,
        status TEXT
    );

    CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT,
        subject TEXT,
        score INTEGER,
        term TEXT,
        date TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT,
        amount REAL,
        paid REAL DEFAULT 0,
        due_date TEXT,
        status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS timetable (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grade TEXT,
        day TEXT,
        period TEXT,
        subject TEXT,
        teacher TEXT,
        room TEXT
    );

    CREATE TABLE IF NOT EXISTS library (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT UNIQUE,
        title TEXT,
        author TEXT,
        category TEXT,
        available INTEGER DEFAULT 1,
        borrowed_by TEXT,
        borrow_date TEXT,
        return_date TEXT
    );

    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        audience TEXT DEFAULT 'all',
        created_at TEXT DEFAULT (datetime('now'))
    );
`);

console.log('Database ready with all tables');

// ==================== AUTH ====================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const exists = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (exists) return res.status(400).json({ message: 'User already exists' });
        const hashed = await bcrypt.hash(password, 10);
        const result = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(name, email, hashed, role);
        const token = jwt.sign({ id: result.lastInsertRowid, role }, 'school_secret', { expiresIn: '1d' });
        res.status(201).json({ token, user: { id: result.lastInsertRowid, name, email, role } });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, role: user.role }, 'school_secret', { expiresIn: '1d' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ==================== STUDENTS ====================
app.get('/api/students', (req, res) => {
    res.json(db.prepare('SELECT * FROM students ORDER BY id DESC').all());
});
app.post('/api/students', (req, res) => {
    try {
        const { first_name, last_name, grade, section, parent_name, parent_phone, address } = req.body;
        const student_id = 'STU' + Date.now().toString().slice(-6);
        db.prepare('INSERT INTO students (first_name, last_name, student_id, grade, section, parent_name, parent_phone, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(first_name, last_name, student_id, grade, section, parent_name, parent_phone, address);
        res.status(201).json({ message: 'Student added', student_id });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.delete('/api/students/:id', (req, res) => {
    db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
    res.json({ message: 'Student deleted' });
});

// ==================== TEACHERS ====================
app.get('/api/teachers', (req, res) => {
    res.json(db.prepare('SELECT * FROM teachers ORDER BY id DESC').all());
});
app.post('/api/teachers', (req, res) => {
    try {
        const { first_name, last_name, qualification, subjects, phone } = req.body;
        const employee_id = 'EMP' + Date.now().toString().slice(-6);
        db.prepare('INSERT INTO teachers (first_name, last_name, employee_id, qualification, subjects, phone) VALUES (?, ?, ?, ?, ?, ?)').run(first_name, last_name, employee_id, qualification, subjects, phone);
        res.status(201).json({ message: 'Teacher added', employee_id });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.delete('/api/teachers/:id', (req, res) => {
    db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
    res.json({ message: 'Teacher deleted' });
});

// ==================== ATTENDANCE ====================
app.get('/api/attendance', (req, res) => {
    const { date } = req.query;
    let records;
    if (date) {
        records = db.prepare('SELECT a.*, s.first_name, s.last_name, s.grade FROM attendance a JOIN students s ON a.student_id = s.student_id WHERE a.date = ?').all(date);
    } else {
        records = db.prepare('SELECT a.*, s.first_name, s.last_name, s.grade FROM attendance a JOIN students s ON a.student_id = s.student_id ORDER BY a.date DESC').all();
    }
    res.json(records);
});
app.post('/api/attendance', (req, res) => {
    try {
        const { student_id, date, status } = req.body;
        const exists = db.prepare('SELECT * FROM attendance WHERE student_id = ? AND date = ?').get(student_id, date);
        if (exists) {
            db.prepare('UPDATE attendance SET status = ? WHERE student_id = ? AND date = ?').run(status, student_id, date);
        } else {
            db.prepare('INSERT INTO attendance (student_id, date, status) VALUES (?, ?, ?)').run(student_id, date, status);
        }
        res.json({ message: 'Attendance recorded' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ==================== GRADES ====================
app.get('/api/grades', (req, res) => {
    res.json(db.prepare('SELECT g.*, s.first_name, s.last_name, s.grade FROM grades g JOIN students s ON g.student_id = s.student_id ORDER BY g.date DESC').all());
});
app.post('/api/grades', (req, res) => {
    try {
        const { student_id, subject, score, term } = req.body;
        db.prepare('INSERT INTO grades (student_id, subject, score, term) VALUES (?, ?, ?, ?)').run(student_id, subject, score, term);
        res.status(201).json({ message: 'Grade recorded' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ==================== FEES ====================
app.get('/api/fees', (req, res) => {
    res.json(db.prepare('SELECT f.*, s.first_name, s.last_name, s.grade FROM fees f JOIN students s ON f.student_id = s.student_id ORDER BY f.due_date DESC').all());
});
app.post('/api/fees', (req, res) => {
    try {
        const { student_id, amount, due_date } = req.body;
        db.prepare('INSERT INTO fees (student_id, amount, due_date) VALUES (?, ?, ?)').run(student_id, amount, due_date);
        res.status(201).json({ message: 'Fee record created' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.put('/api/fees/:id', (req, res) => {
    try {
        const { paid } = req.body;
        const fee = db.prepare('SELECT * FROM fees WHERE id = ?').get(req.params.id);
        const newPaid = fee.paid + paid;
        const status = newPaid >= fee.amount ? 'paid' : 'partial';
        db.prepare('UPDATE fees SET paid = ?, status = ? WHERE id = ?').run(newPaid, status, req.params.id);
        res.json({ message: 'Payment recorded' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ==================== TIMETABLE ====================
app.get('/api/timetable', (req, res) => {
    const { grade, day } = req.query;
    let records;
    if (grade && day) {
        records = db.prepare('SELECT * FROM timetable WHERE grade = ? AND day = ? ORDER BY period').all(grade, day);
    } else {
        records = db.prepare('SELECT * FROM timetable ORDER BY grade, day, period').all();
    }
    res.json(records);
});
app.post('/api/timetable', (req, res) => {
    try {
        const { grade, day, period, subject, teacher, room } = req.body;
        db.prepare('INSERT INTO timetable (grade, day, period, subject, teacher, room) VALUES (?, ?, ?, ?, ?, ?)').run(grade, day, period, subject, teacher, room);
        res.status(201).json({ message: 'Timetable entry added' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.delete('/api/timetable/:id', (req, res) => {
    db.prepare('DELETE FROM timetable WHERE id = ?').run(req.params.id);
    res.json({ message: 'Timetable entry deleted' });
});

// ==================== LIBRARY ====================
app.get('/api/library', (req, res) => {
    res.json(db.prepare('SELECT * FROM library ORDER BY id DESC').all());
});
app.post('/api/library', (req, res) => {
    try {
        const { title, author, category } = req.body;
        const book_id = 'BK' + Date.now().toString().slice(-6);
        db.prepare('INSERT INTO library (book_id, title, author, category) VALUES (?, ?, ?, ?)').run(book_id, title, author, category);
        res.status(201).json({ message: 'Book added', book_id });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.put('/api/library/:id/borrow', (req, res) => {
    try {
        const { borrowed_by } = req.body;
        db.prepare("UPDATE library SET available = 0, borrowed_by = ?, borrow_date = date('now') WHERE id = ?").run(borrowed_by, req.params.id);
        res.json({ message: 'Book borrowed' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.put('/api/library/:id/return', (req, res) => {
    try {
        db.prepare("UPDATE library SET available = 1, borrowed_by = NULL, borrow_date = NULL, return_date = date('now') WHERE id = ?").run(req.params.id);
        res.json({ message: 'Book returned' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ==================== ANNOUNCEMENTS ====================
app.get('/api/announcements', (req, res) => {
    res.json(db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all());
});
app.post('/api/announcements', (req, res) => {
    try {
        const { title, content, audience } = req.body;
        db.prepare('INSERT INTO announcements (title, content, audience) VALUES (?, ?, ?)').run(title, content, audience || 'all');
        res.status(201).json({ message: 'Announcement posted' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.delete('/api/announcements/:id', (req, res) => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
    res.json({ message: 'Announcement deleted' });
});

app.get('/', (req, res) => res.json({ message: 'School API running' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));