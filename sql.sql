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