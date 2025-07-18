const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3087;
const host = process.env.HOST || '0.0.0.0';

// Enhanced configuration
require('dotenv').config();

// Database configuration with connection retry
const poolConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  database: process.env.DB_NAME || 'new_employee_db',
  password: process.env.DB_PASSWORD || 'admin123',
  port: process.env.DB_PORT || 5432,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 20
};

const pool = new Pool(poolConfig);

// Enhanced CORS configuration
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://56.228.28.195:5500',
  'http://56.228.28.195:8037',
  'http://56.228.28.195:8038'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection health check
async function checkDatabaseConnection() {
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    console.log('Database connection established successfully');
    return true;
  } catch (error) {
    console.error('Database connection error:', error);
    return false;
  } finally {
    if (client) client.release();
  }
}

// Initialize database with retry logic
async function initializeDatabase() {
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT valid_emp_id CHECK (emp_id ~ '^[A-Z]{3}0[0-9]{3}$'),
          CONSTRAINT valid_email CHECK (email ~ '^[a-zA-Z0-9._%+-]+@astrolitetech\\.com$')
        );
      `);
      console.log('Database table "leaves" initialized successfully');
      return;
    } catch (error) {
      retries++;
      console.error(`Attempt ${retries} failed. Error initializing database:`, error);
      if (retries >= maxRetries) {
        console.error('Max retries reached. Could not initialize database.');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Validation functions
const validators = {
  empId: (emp_id) => /^[A-Z]{3}0[0-9]{3}$/.test(emp_id),
  email: (email) => /^[a-zA-Z0-9._%+-]+@astrolitetech\.com$/.test(email),
  name: (name) => /^[A-Za-z]+(?:\.[A-Za-z]+)*(?: [A-Za-z]+)*(?:\.[A-Za-z]+){0,3}$/.test(name),
  leaveType: (type) => ['sick', 'casual', 'earned', 'paternity', 'maternity', 'marriage'].includes(type),
  dates: (from_date, to_date) => {
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
  },
  hours: (from_hour, to_hour, from_date, to_date) => {
    if (from_date === to_date && from_hour && to_hour) {
      const fromTime = new Date(`1970-01-01T${from_hour}Z`);
      const toTime = new Date(`1970-01-01T${to_hour}Z`);
      if (toTime <= fromTime) {
        return 'To Hour must be after From Hour';
      }
    }
    return null;
  },
  reason: (reason) => reason.length >= 5 && reason.length <= 100
};

// API Routes

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbStatus = await checkDatabaseConnection();
  res.status(dbStatus ? 200 : 503).json({
    status: dbStatus ? 'healthy' : 'unhealthy',
    database: dbStatus ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Submit leave request
app.post('/api/leaves', async (req, res) => {
  try {
    const { emp_id, name, email, leave_type, from_date, to_date, from_hour, to_hour, reason } = req.body;

    // Validate all required fields
    if (!emp_id || !name || !email || !leave_type || !from_date || !to_date || !reason) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    if (!validators.empId(emp_id)) {
      return res.status(400).json({ error: 'Invalid Employee ID format (e.g., ABC0123)' });
    }

    if (!validators.name(name)) {
      return res.status(400).json({ error: 'Invalid name format' });
    }

    if (!validators.email(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!validators.leaveType(leave_type)) {
      return res.status(400).json({ error: 'Invalid leave type' });
    }

    const dateError = validators.dates(from_date, to_date);
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }

    const hourError = validators.hours(from_hour, to_hour, from_date, to_date);
    if (hourError) {
      return res.status(400).json({ error: hourError });
    }

    if (!validators.reason(reason)) {
      return res.status(400).json({ error: 'Reason must be between 5 and 100 characters' });
    }

    // Check for overlapping approved leaves
    const overlapCheck = await pool.query(
      `SELECT * FROM leaves 
       WHERE emp_id = $1 AND status = 'Approved' 
       AND NOT (to_date < $2 OR from_date > $3)`,
      [emp_id, from_date, to_date]
    );

    if (overlapCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Leave request overlaps with an existing approved leave' });
    }

    const result = await pool.query(
      `INSERT INTO leaves (emp_id, name, email, leave_type, from_date, to_date, from_hour, to_hour, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [emp_id, name, email, leave_type, from_date, to_date, from_hour || null, to_hour || null, reason]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting leave:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get all leaves
app.get('/api/leaves', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status
      ? `SELECT * FROM leaves WHERE status = $1 ORDER BY created_at DESC`
      : `SELECT * FROM leaves ORDER BY created_at DESC`;
    const params = status ? [status] : [];
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leaves:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get leaves for specific employee
app.get('/api/leaves/:emp_id', async (req, res) => {
  try {
    const { emp_id } = req.params;
    if (!validators.empId(emp_id)) {
      return res.status(400).json({ error: 'Invalid Employee ID format' });
    }

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

// Update leave status
app.put('/api/leaves/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

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

// Get leave statistics
app.get('/api/leave-stats/:emp_id', async (req, res) => {
  try {
    const { emp_id } = req.params;
    if (!validators.empId(emp_id)) {
      return res.status(400).json({ error: 'Invalid Employee ID format' });
    }

    // Calculate total approved leave days
    const leaveDaysResult = await pool.query(
      `SELECT SUM(to_date - from_date + 1) as total_days
       FROM leaves 
       WHERE emp_id = $1 AND status = 'Approved'`,
      [emp_id]
    );

    const totalLeaveDays = leaveDaysResult.rows[0].total_days || 0;
    const allocatedLeaves = 45; // Set allocated leaves to 45
    const remainingLeaves = allocatedLeaves - totalLeaveDays;

    res.json({
      allocatedLeaves,
      remainingLeaves: remainingLeaves >= 0 ? remainingLeaves : 0
    });
  } catch (error) {
    console.error('Error fetching leave stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
async function startServer() {
  try {
    await checkDatabaseConnection();
    await initializeDatabase();
    app.listen(port, host, () => {
      console.log(`Server running at http://${host}:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});