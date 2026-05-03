import pool from "../config/db.js";

// Submit a new complaint
export const submitComplaint = async (req, res) => {
  const { user_id, subject, description, category, priority } = req.body;

  if (!user_id || !subject || !description) {
    return res.status(400).json({
      success: false,
      message: "User ID, subject and description are required",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO complaints (user_id, subject, description, category, priority, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
      [
        user_id,
        subject,
        description,
        category || "general",
        priority || "medium",
      ],
    );

    res.status(201).json({
      success: true,
      message: "Complaint submitted successfully",
      complaint: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// Get complaints for a specific user
export const getUserComplaints = async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.*, u.name as user_name, u.phone_number, u.email 
       FROM complaints c 
       JOIN users u ON c.user_id = u.user_id 
       WHERE c.user_id = $1 AND u.isdeleted = false 
       ORDER BY c.created_at DESC`,
      [userId],
    );

    res.json({
      success: true,
      complaints: result.rows,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// Get all complaints (Admin view)
export const getAllComplaints = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name as user_name, u.phone_number, u.email 
       FROM complaints c 
       JOIN users u ON c.user_id = u.user_id 
       WHERE u.isdeleted = false 
       ORDER BY c.created_at DESC`,
    );

    res.json({
      success: true,
      complaints: result.rows,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// Update complaint status (Admin function)
export const updateComplaintStatus = async (req, res) => {
  const { id } = req.params;
  const { status, priority, resolution, assigned_to } = req.body;

  try {
    let query = "UPDATE complaints SET updated_at = NOW()";
    let values = [];
    let valueIndex = 1;

    if (status) {
      query += `, status = $${valueIndex}`;
      values.push(status);
      valueIndex++;

      // If status is resolved, set resolved_at
      if (status === "resolved") {
        query += `, resolved_at = NOW()`;
      }
    }

    if (priority) {
      query += `, priority = $${valueIndex}`;
      values.push(priority);
      valueIndex++;
    }

    if (resolution) {
      query += `, resolution = $${valueIndex}`;
      values.push(resolution);
      valueIndex++;
    }

    if (assigned_to) {
      query += `, assigned_to = $${valueIndex}`;
      values.push(assigned_to);
      valueIndex++;
    }

    query += ` WHERE complaint_id = $${valueIndex} RETURNING *`;
    values.push(id);

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    res.json({
      success: true,
      message: "Complaint updated successfully",
      complaint: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// Delete complaint
export const deleteComplaint = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM complaints WHERE complaint_id = $1 RETURNING *",
      [id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    res.json({
      success: true,
      message: "Complaint deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// Get complaint statistics (Admin dashboard)
export const getComplaintStats = async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_complaints,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_complaints,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_complaints,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_complaints,
        COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_complaints
      FROM complaints c
      JOIN users u ON c.user_id = u.user_id
      WHERE u.isdeleted = false
    `);

    res.json({
      success: true,
      stats: stats.rows[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};
