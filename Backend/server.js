const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = 3087;
const host = '0.0.0.0';

const pool = new Pool({
    user: 'postgres',
    host: 'postgres',
    database: 'new_employee_db',
    password: 'admin123',
    port: 5432,
});

app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500','http://13.48.59.154:5500','http://13.48.59.154:8311','http://13.48.59.154:8312']
}));
app.use(express.json());

// Initialize database table
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS leaves (
                id SERIAL PRIMARY KEY,
                emp_id VARCHAR(7) NOT NULL,
                name VARCHAR(50) NOT NULL,
                email VARCHAR(50) NOT NULL,
                leave_type VARCHAR(20) NOT NULL,
                from_date DATE NOT NULL,
                to_date DATE NOT NULL,
                from_hour TIME,
                to_hour TIME,
                reason TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Database table "leaves" initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

// Validate Employee ID
function validateEmpId(emp_id) {
    const regex = /^[A-Z]{3}0[0-9]{3}$/;
    return regex.test(emp_id);
}

// Validate Email
function validateEmail(email) {
    const regex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z]{2,15}\.[a-zA-Z]{2,3}$/;
    return regex.test(email);
}

// Validate Name
function validateName(name) {
    const regex = /^[A-Za-z]+(?:\.[A-Za-z]+)*(?: [A-Za-z]+)*(?:\.[A-Za-z]+){0,3}$/;
    return regex.test(name);
}

// Validate Dates
function validateDates(from_date, to_date) {
    const today = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(today.getMonth() - 3);
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(today.getFullYear() + 1);

    const fromDate = new Date(from_date);
    const toDate = new Date(to_date);

    if (fromDate < threeMonthsAgo || fromDate > oneYearFromNow) {
        return 'From Date must be within the last 3 months or up to 1 year from now';
    }
    if (toDate < fromDate) {
        return 'To Date cannot be earlier than From Date';
    }
    if (toDate > oneYearFromNow) {
        return 'To Date cannot be more than 1 year from now';
    }
    return null;
}

// Validate Hours
function validateHours(from_hour, to_hour, from_date, to_date) {
    if (from_date === to_date && from_hour && to_hour) {
        const fromTime = new Date(`1970-01-01T${from_hour}Z`);
        const toTime = new Date(`1970-01-01T${to_hour}Z`);
        if (toTime <= fromTime) {
            return 'To Hour must be after From Hour';
        }
    }
    return null;
}

// POST /api/leaves - Submit a new leave request
app.post('/api/leaves', async (req, res) => {
    const { emp_id, name, email, leave_type, from_date, to_date, from_hour, to_hour, reason } = req.body;

    // Input validation
    if (!emp_id || !name || !email || !leave_type || !from_date || !to_date || !reason) {
        return res.status(400).json({ error: 'All required fields must be provided' });
    }

    if (!validateEmpId(emp_id)) {
        return res.status(400).json({ error: 'Invalid Employee ID format (e.g., ABC0123)' });
    }

    if (!validateName(name)) {
        return res.status(400).json({ error: 'Invalid name format' });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!['sick', 'casual', 'earned'].includes(leave_type)) {
        return res.status(400).json({ error: 'Invalid leave type' });
    }

    const dateError = validateDates(from_date, to_date);
    if (dateError) {
        return res.status(400).json({ error: dateError });
    }

    const hourError = validateHours(from_hour, to_hour, from_date, to_date);
    if (hourError) {
        return res.status(400).json({ error: hourError });
    }

    if (reason.length < 5 || reason.length > 100) {
        return res.status(400).json({ error: 'Reason must be between 5 and 100 characters' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO leaves (emp_id, name, email, leave_type, from_date, to_date, from_hour, to_hour, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [emp_id, name, email, leave_type, from_date, to_date, from_hour || null, to_hour || null, reason]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error submitting leave:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/leaves - Fetch all leaves (with optional status filter)
app.get('/api/leaves', async (req, res) => {
    const { status } = req.query;
    try {
        const query = status
            ? `SELECT * FROM leaves WHERE status = $1 ORDER BY created_at DESC`
            : `SELECT * FROM leaves ORDER BY created_at DESC`;
        const result = await pool.query(query, status ? [status] : []);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching leaves:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/leaves/:emp_id - Fetch leaves for a specific employee
app.get('/api/leaves/:emp_id', async (req, res) => {
    const { emp_id } = req.params;
    if (!validateEmpId(emp_id)) {
        return res.status(400).json({ error: 'Invalid Employee ID format' });
    }
    try {
        const result = await pool.query(
            `SELECT * FROM leaves WHERE emp_id = $1 ORDER BY created_at DESC`,
            [emp_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching employee leaves:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/leaves/:id - Update leave status
app.put('/api/leaves/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const result = await pool.query(
            `UPDATE leaves SET status = $1 WHERE id = $2 RETURNING *`,
            [status, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Leave not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating leave status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/leave-stats/:emp_id - Fetch leave statistics
app.get('/api/leave-stats/:emp_id', async (req, res) => {
    const { emp_id } = req.params;
    if (!validateEmpId(emp_id)) {
        return res.status(400).json({ error: 'Invalid Employee ID format' });
    }
    try {
        const allocatedLeaves = 30; // Example value
        const result = await pool.query(
            `SELECT from_date, to_date FROM leaves WHERE emp_id = $1 AND status = 'Approved'`,
            [emp_id]
        );
        let usedLeaves = 0;
        result.rows.forEach(leave => {
            const fromDate = new Date(leave.from_date);
            const toDate = new Date(leave.to_date);
            const days = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
            usedLeaves += days;
        });
        const remainingLeaves = allocatedLeaves - usedLeaves;
        res.json({ allocatedLeaves, remainingLeaves });
    } catch (error) {
        console.error('Error fetching leave stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(port, host, async () => {
    await initializeDatabase();
    console.log(`Server running on http://${host}:${port}`);
});