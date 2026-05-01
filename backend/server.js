const express = require('express');
const cors = require('cors');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = process.env.DB_PATH || 'school.db';

let db;

async function initDB() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }
    
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL
        )
    `);
    db.run(`CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, student_id TEXT UNIQUE, grade TEXT, section TEXT, parent_name TEXT, parent_phone TEXT, address TEXT, enrollment_date TEXT DEFAULT (date('now')))`);
    db.run(`CREATE TABLE IF NOT EXISTS teachers (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, employee_id TEXT UNIQUE, qualification TEXT, subjects TEXT, phone TEXT, hire_date TEXT DEFAULT (date('now')))`);
    db.run(`CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, date TEXT, status TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS grades (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, subject TEXT, score INTEGER, term TEXT, date TEXT DEFAULT (date('now')))`);
    db.run(`CREATE TABLE IF NOT EXISTS fees (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, amount REAL, paid REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT 'pending')`);
    db.run(`CREATE TABLE IF NOT EXISTS timetable (id INTEGER PRIMARY KEY AUTOINCREMENT, grade TEXT, day TEXT, period TEXT, subject TEXT, teacher TEXT, room TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT UNIQUE, title TEXT, author TEXT, category TEXT, available INTEGER DEFAULT 1, borrowed_by TEXT, borrow_date TEXT, return_date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, audience TEXT DEFAULT 'all', created_at TEXT DEFAULT (datetime('now')))`);
    
    saveDB();
    console.log('Database ready');
}

function saveDB() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

function run(sql, params = []) {
    db.run(sql, params);
    saveDB();
    return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] };
}

function get(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const obj = {};
        cols.forEach((col, i) => obj[col] = vals[i]);
        stmt.free();
        return obj;
    }
    stmt.free();
    return null;
}

function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    const cols = stmt.getColumnNames();
    while (stmt.step()) {
        const vals = stmt.get();
        const obj = {};
        cols.forEach((col, i) => obj[col] = vals[i]);
        results.push(obj);
    }
    stmt.free();
    return results;
}

// Start server after DB init
initDB().then(() => {
    // AUTH
    app.post('/api/auth/register', async (req, res) => {
        try {
            const { name, email, password, role } = req.body;
            const exists = get('SELECT * FROM users WHERE email = ?', [email]);
            if (exists) return res.status(400).json({ message: 'User already exists' });
            const hashed = await bcrypt.hash(password, 10);
            const result = run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [name, email, hashed, role]);
            const token = jwt.sign({ id: result.lastInsertRowid, role }, 'school_secret', { expiresIn: '1d' });
            res.status(201).json({ token, user: { id: result.lastInsertRowid, name, email, role } });
        } catch (err) { res.status(500).json({ message: err.message }); }
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            const user = get('SELECT * FROM users WHERE email = ?', [email]);
            if (!user) return res.status(400).json({ message: 'Invalid credentials' });
            const match = await bcrypt.compare(password, user.password);
            if (!match) return res.status(400).json({ message: 'Invalid credentials' });
            const token = jwt.sign({ id: user.id, role: user.role }, 'school_secret', { expiresIn: '1d' });
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
        } catch (err) { res.status(500).json({ message: err.message }); }
    });

    // STUDENTS
    app.get('/api/students', (req, res) => res.json(all('SELECT * FROM students ORDER BY id DESC')));
    app.post('/api/students', (req, res) => {
        try {
            const { first_name, last_name, grade, section, parent_name, parent_phone, address } = req.body;
            const student_id = 'STU' + Date.now().toString().slice(-6);
            run('INSERT INTO students (first_name, last_name, student_id, grade, section, parent_name, parent_phone, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [first_name, last_name, student_id, grade, section, parent_name, parent_phone, address]);
            res.status(201).json({ message: 'Student added', student_id });
        } catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.delete('/api/students/:id', (req, res) => { run('DELETE FROM students WHERE id = ?', [req.params.id]); res.json({ message: 'Deleted' }); });

    // TEACHERS
    app.get('/api/teachers', (req, res) => res.json(all('SELECT * FROM teachers ORDER BY id DESC')));
    app.post('/api/teachers', (req, res) => {
        try {
            const { first_name, last_name, qualification, subjects, phone } = req.body;
            const employee_id = 'EMP' + Date.now().toString().slice(-6);
            run('INSERT INTO teachers (first_name, last_name, employee_id, qualification, subjects, phone) VALUES (?, ?, ?, ?, ?, ?)', [first_name, last_name, employee_id, qualification, subjects, phone]);
            res.status(201).json({ message: 'Teacher added', employee_id });
        } catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.delete('/api/teachers/:id', (req, res) => { run('DELETE FROM teachers WHERE id = ?', [req.params.id]); res.json({ message: 'Deleted' }); });

    // ATTENDANCE
    app.get('/api/attendance', (req, res) => {
        const { date } = req.query;
        let records = date ? all('SELECT a.*, s.first_name, s.last_name, s.grade FROM attendance a JOIN students s ON a.student_id = s.student_id WHERE a.date = ?', [date]) : all('SELECT a.*, s.first_name, s.last_name, s.grade FROM attendance a JOIN students s ON a.student_id = s.student_id ORDER BY a.date DESC');
        res.json(records);
    });
    app.post('/api/attendance', (req, res) => {
        try {
            const { student_id, date, status } = req.body;
            const exists = get('SELECT * FROM attendance WHERE student_id = ? AND date = ?', [student_id, date]);
            if (exists) run('UPDATE attendance SET status = ? WHERE student_id = ? AND date = ?', [status, student_id, date]);
            else run('INSERT INTO attendance (student_id, date, status) VALUES (?, ?, ?)', [student_id, date, status]);
            res.json({ message: 'Recorded' });
        } catch (err) { res.status(500).json({ message: err.message }); }
    });

    // GRADES
    app.get('/api/grades', (req, res) => res.json(all('SELECT g.*, s.first_name, s.last_name, s.grade FROM grades g JOIN students s ON g.student_id = s.student_id ORDER BY g.date DESC')));
    app.post('/api/grades', (req, res) => {
        try { const { student_id, subject, score, term } = req.body; run('INSERT INTO grades (student_id, subject, score, term) VALUES (?, ?, ?, ?)', [student_id, subject, score, term]); res.status(201).json({ message: 'Grade recorded' }); }
        catch (err) { res.status(500).json({ message: err.message }); }
    });

    // FEES
    app.get('/api/fees', (req, res) => res.json(all('SELECT f.*, s.first_name, s.last_name, s.grade FROM fees f JOIN students s ON f.student_id = s.student_id ORDER BY f.due_date DESC')));
    app.post('/api/fees', (req, res) => {
        try { const { student_id, amount, due_date } = req.body; run('INSERT INTO fees (student_id, amount, due_date) VALUES (?, ?, ?)', [student_id, amount, due_date]); res.status(201).json({ message: 'Fee created' }); }
        catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.put('/api/fees/:id', (req, res) => {
        try {
            const { paid } = req.body;
            const fee = get('SELECT * FROM fees WHERE id = ?', [req.params.id]);
            const newPaid = fee.paid + paid;
            const status = newPaid >= fee.amount ? 'paid' : 'partial';
            run('UPDATE fees SET paid = ?, status = ? WHERE id = ?', [newPaid, status, req.params.id]);
            res.json({ message: 'Payment recorded' });
        } catch (err) { res.status(500).json({ message: err.message }); }
    });

    // TIMETABLE
    app.get('/api/timetable', (req, res) => {
        const { grade, day } = req.query;
        let records = (grade && day) ? all('SELECT * FROM timetable WHERE grade = ? AND day = ? ORDER BY period', [grade, day]) : all('SELECT * FROM timetable ORDER BY grade, day, period');
        res.json(records);
    });
    app.post('/api/timetable', (req, res) => {
        try { const { grade, day, period, subject, teacher, room } = req.body; run('INSERT INTO timetable (grade, day, period, subject, teacher, room) VALUES (?, ?, ?, ?, ?, ?)', [grade, day, period, subject, teacher, room]); res.status(201).json({ message: 'Added' }); }
        catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.delete('/api/timetable/:id', (req, res) => { run('DELETE FROM timetable WHERE id = ?', [req.params.id]); res.json({ message: 'Deleted' }); });

    // LIBRARY
    app.get('/api/library', (req, res) => res.json(all('SELECT * FROM library ORDER BY id DESC')));
    app.post('/api/library', (req, res) => {
        try { const { title, author, category } = req.body; const book_id = 'BK' + Date.now().toString().slice(-6); run('INSERT INTO library (book_id, title, author, category) VALUES (?, ?, ?, ?)', [book_id, title, author, category]); res.status(201).json({ message: 'Book added', book_id }); }
        catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.put('/api/library/:id/borrow', (req, res) => {
        try { const { borrowed_by } = req.body; run("UPDATE library SET available = 0, borrowed_by = ?, borrow_date = date('now') WHERE id = ?", [borrowed_by, req.params.id]); res.json({ message: 'Borrowed' }); }
        catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.put('/api/library/:id/return', (req, res) => {
        try { run("UPDATE library SET available = 1, borrowed_by = NULL, borrow_date = NULL, return_date = date('now') WHERE id = ?", [req.params.id]); res.json({ message: 'Returned' }); }
        catch (err) { res.status(500).json({ message: err.message }); }
    });

    // ANNOUNCEMENTS
    app.get('/api/announcements', (req, res) => res.json(all('SELECT * FROM announcements ORDER BY created_at DESC')));
    app.post('/api/announcements', (req, res) => {
        try { const { title, content, audience } = req.body; run('INSERT INTO announcements (title, content, audience) VALUES (?, ?, ?)', [title, content, audience || 'all']); res.status(201).json({ message: 'Posted' }); }
        catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.delete('/api/announcements/:id', (req, res) => { run('DELETE FROM announcements WHERE id = ?', [req.params.id]); res.json({ message: 'Deleted' }); });

    app.get('/', (req, res) => res.json({ message: 'School API running' }));

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});