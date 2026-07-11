const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getPGHostelModel } = require('../models/PGHostel');
const { getPGRoomModel } = require('../models/PGRoom');
const { getPGBookingModel } = require('../models/PGBooking');
const { getUserModel } = require('../models/User');

// GET all PGs (Student Search)
router.get('/', async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pgs = await PGHostel.findAll({
      where: { isActive: true },
      order: [['distanceFromCollege', 'ASC']]
    });
    res.json(pgs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET PG details & rooms
router.get('/:id', async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const PGRoom = getPGRoomModel();
    const pg = await PGHostel.findByPk(req.params.id, {
      include: [{ model: PGRoom, as: 'rooms', where: { isActive: true }, required: false }]
    });
    if (!pg) return res.status(404).json({ message: 'PG not found.' });
    res.json(pg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST Book a room
router.post('/:roomId/book', protect, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const PGBooking = getPGBookingModel();
    const User = getUserModel();
    const room = await PGRoom.findByPk(req.params.roomId);
    
    if (!room || !room.isActive) return res.status(404).json({ message: 'Room not found.' });
    if (room.availableBeds <= 0) return res.status(400).json({ message: 'No beds available.' });

    const booking = await PGBooking.create({
      userId: req.user.id,
      hostelId: room.hostelId,
      roomId: room.id,
      checkInDate: new Date(req.body.checkInDate || Date.now()),
      status: 'Pending'
    });

    // We don't deduct beds until confirmed by owner.
    res.status(201).json({ message: 'Booking request sent.', booking });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST Create a PG (Owner)
router.post('/', protect, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const { name, address, distanceFromCollege, genderType, baseRent, amenities, images, description } = req.body;
    
    const pg = await PGHostel.create({
      ownerId: req.user.id,
      name, address, distanceFromCollege, genderType, baseRent, amenities, images, description
    });
    res.status(201).json(pg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all PGs for Admin (includes inactive)
router.get('/admin/admin-all', protect, admin, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pgs = await PGHostel.findAll({
      order: [['distanceFromCollege', 'ASC']]
    });
    res.json(pgs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT Update a PG Hostel
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pg = await PGHostel.findByPk(req.params.id);
    if (!pg) return res.status(404).json({ message: 'PG not found.' });

    const { name, address, distanceFromCollege, genderType, baseRent, amenities, images, description, isActive } = req.body;
    await pg.update({
      name, address, distanceFromCollege, genderType, baseRent, amenities, images, description, isActive
    });
    res.json(pg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a PG Hostel
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pg = await PGHostel.findByPk(req.params.id);
    if (!pg) return res.status(404).json({ message: 'PG not found.' });
    await pg.destroy();
    res.json({ message: 'PG deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all rooms for a PG Hostel (Admin)
router.get('/:id/rooms-all', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const rooms = await PGRoom.findAll({
      where: { hostelId: req.params.id }
    });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST Create a Room
router.post('/:id/rooms', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const { roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive } = req.body;
    const room = await PGRoom.create({
      hostelId: req.params.id,
      roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive: isActive ?? true
    });
    res.status(201).json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT Update a Room
router.put('/:id/rooms/:roomId', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const room = await PGRoom.findOne({
      where: { id: req.params.roomId, hostelId: req.params.id }
    });
    if (!room) return res.status(404).json({ message: 'Room not found.' });

    const { roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive } = req.body;
    await room.update({
      roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive
    });
    res.json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a Room
router.delete('/:id/rooms/:roomId', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const room = await PGRoom.findOne({
      where: { id: req.params.roomId, hostelId: req.params.id }
    });
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    await room.destroy();
    res.json({ message: 'Room deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
