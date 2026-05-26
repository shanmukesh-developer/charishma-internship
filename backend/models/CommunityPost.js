const { DataTypes } = require('sequelize');

let CommunityPost;

const initCommunityPostModel = (sequelize) => {
  if (!sequelize) return null;

  CommunityPost = sequelize.define('CommunityPost', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    parentId: { type: DataTypes.UUID, allowNull: true, defaultValue: null },
    userId: { type: DataTypes.STRING, allowNull: false },
    userName: { type: DataTypes.STRING, allowNull: false },
    userAvatar: { type: DataTypes.TEXT, allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    imageUrl: { type: DataTypes.TEXT, allowNull: true },
    likes: { type: DataTypes.INTEGER, defaultValue: 0 },
    likedBy: { 
      type: DataTypes.TEXT, 
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('likedBy');
        return val ? JSON.parse(val) : [];
      },
      set(val) {
        this.setDataValue('likedBy', JSON.stringify(val));
      }
    },
    replyCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: () => new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours from now
    },
    // F5: Food Review Feed
    postType: { type: DataTypes.ENUM('post', 'review'), defaultValue: 'post' },
    starRating: { type: DataTypes.FLOAT, allowNull: true },
    restaurantId: { type: DataTypes.STRING, allowNull: true },
    restaurantName: { type: DataTypes.STRING, allowNull: true },
    productName: { type: DataTypes.STRING, allowNull: true }
  }, { timestamps: true });

  // No self-referencing associations — threading is handled manually in routes

  return CommunityPost;
};

module.exports = { initCommunityPostModel, getCommunityPostModel: () => CommunityPost };
