const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();
app.use(express.json());
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => console.log("Server Running at Port 3000"));
  } catch (error) {
    console.log(`DB Error:${error.message}`);
    process.exit(1);
  }
};
initializeDbAndServer();

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `
        SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    const createUserQuery = ` 
            INSERT INTO 
                user (name,username,password,gender)
            VALUES ('${name}','${username}','${hashedPassword}','${gender}');`;
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
  const userIdResponse = await db.get(userIdQuery);
  const loggedInUserId = userIdResponse.user_id;

  const getFeedQuery = `
        SELECT 
            user.username, tweet.tweet, tweet.date_time AS dateTime 
        FROM 
            follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id
            INNER JOIN user ON tweet.user_id = user.user_id
        WHERE follower.follower_user_id = ${loggedInUserId}
        ORDER BY tweet.date_time DESC 
        LIMIT 4;`;
  const feed = await db.all(getFeedQuery);
  response.send(feed);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
  const userIdResponse = await db.get(userIdQuery);
  const loggedInUserId = userIdResponse.user_id;

  const getFollowingQuery = `
        SELECT user.username AS name 
        FROM follower INNER JOIN user ON follower.following_user_id = user.user_id
        WHERE follower.follower_user_id = ${loggedInUserId};`;
  const userFollowingQuery = await db.all(getFollowingQuery);
  response.send(userFollowingQuery);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
  const userIdResponse = await db.get(userIdQuery);
  const loggedInUserId = userIdResponse.user_id;
  console.log(loggedInUserId);

  const getFollowersQuery = `
        SELECT user.username AS name 
        FROM follower INNER JOIN user ON  follower.follower_user_id = user.user_id
        WHERE follower.following_user_id = ${loggedInUserId};`;
  const followersArray = await db.all(getFollowersQuery);
  response.send(followersArray);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;

  const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
  const userIdResponse = await db.get(userIdQuery);
  const loggedInUserId = userIdResponse.user_id;

  const { tweetId } = request.params;
  const userOfTweetQuery = `
        SELECT user.user_id 
        FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE tweet_id = ${tweetId};`;
  const tweetUserIdObject = await db.get(userOfTweetQuery);
  const tweetUserId = tweetUserIdObject.user_id;
  console.log(tweetUserId);

  const userFollowingUserIdsQuery = `
        SELECT following_user_id 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';`;
  const followingUsersResponse = await db.all(userFollowingUserIdsQuery);

  console.log(followingUsersResponse);

  let followingUserIdsArray = [];
  followingUserIdsArray = followingUsersResponse.map((eachObject) =>
    followingUserIdsArray.push(eachObject.following_user_id)
  );

  const isTweetValid = followingUserIdsArray.includes(tweetUserId);

  if (isTweetValid) {
    const getTweetDetailsQuery = `
         SELECT 
            tweet.tweet,
            COUNT (like.like_id) AS likes ,
            COUNT (reply.reply_id) AS replies,
            tweet.date_time AS dateTime
        FROM tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
                INNER JOIN  reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const tweetDetails = await db.get(getTweetDetailsQuery);
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;

    const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
    const userIdResponse = await db.get(userIdQuery);
    const loggedInUserId = userIdResponse.user_id;

    const { tweetId } = request.params;
    const userOfTweetQuery = `
        SELECT user.user_id FROM user INNER JOIN tweet ON 
        user.user_id = tweet.user_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const tweetUserIdObject = await db.get(userOfTweetQuery);
    const tweetUserId = tweetUserIdObject.user_id;

    const userFollowingUserIdsQuery = `
        SELECT following_user_id 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';`;

    const followingUsersResponse = await db.all(userFollowingUserIdsQuery);
    let followingUserIdsArray = [];
    followingUserIdsArray = followingUsersResponse.map((eachObject) =>
      followingUserIdsArray.push(eachObject.following_user_id)
    );

    const isTweetValid = followingUserIdsArray.includes(tweetUserId);

    if (isTweetValid) {
      const likedUsersQuery = `
                SELECT user.username 
                FROM user NATURAL JOIN like 
                WHERE like.tweet_id= ${tweetId};`;
      const likedUsers = await db.all(likedUsersQuery);
      response.send(likedUsers);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;

    const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
    const userIdResponse = await db.get(userIdQuery);
    const loggedInUserId = userIdResponse.user_id;

    const { tweetId } = request.params;
    const userOfTweetQuery = `
        SELECT user.user_id FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE tweet_id = ${tweetId};`;
    const tweetUserIdObject = await db.get(userOfTweetQuery);
    const tweetUserId = tweetUserIdObject.user_id;

    const userFollowingUserIdsQuery = `
        SELECT following_user_id 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';`;
    const followingUsersResponse = await db.all(userFollowingUserIdsQuery);

    let followingUserIdsArray = [];
    followingUserIdsArray = followingUsersResponse.map((eachObject) =>
      followingUserIdsArray.push(eachObject.following_user_id)
    );

    const isTweetValid = followingUserIdsArray.includes(tweetUserId);
    if (isTweetValid) {
      const repliesQuery = `
                SELECT user.username AS name , reply.reply 
                FROM reply INNER JOIN user ON reply.user_id = user.user_id
                WHERE reply.tweet_id = ${tweetId};`;
      const repliesArray = db.all(repliesQuery);
      response.send(repliesArray);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;

  const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
  const userIdResponse = await db.get(userIdQuery);
  const loggedInUserId = userIdResponse.user_id;

  const userTweetsQuery = `
        SELECT 
            tweet.tweet,
            COUNT(like.like_id) AS likes,
            COUNT(reply.reply) AS replies,
            tweet.date_time AS dateTime
        FROM tweet NATURAL JOIN like NATURAL JOIN reply 
        WHERE tweet.user_id = ${loggedInUserId}
        GROUP BY tweet.tweet_id;`;
  const tweetsArray = await db.all(userTweetsQuery);
  response.send(tweetsArray);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;

  const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
  const userIdResponse = await db.get(userIdQuery);
  const loggedInUserId = userIdResponse.user_id;

  const { tweet } = request.body;

  const dateTime = new Date();

  const addTweetQuery = `
        INSERT INTO tweet (tweet,user_id,date_time)
        VALUES ('${tweet}',${loggedInUserId},'${dateTime}');`;
  const dbResponse = await db.run(addTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;

    const userIdQuery = `
    SELECT user_id FROM user WHERE user.username = '${username}';`;
    const userIdResponse = await db.get(userIdQuery);
    const loggedInUserId = userIdResponse.user_id;

    const { tweetId } = request.params;

    const getUserTweetsQuery = ` 
        SELECT tweet_id FROM tweet WHERE user_id = ${loggedInUserId};`;
    const userTweetsIdResponse = await db.all(getUserTweetsQuery);

    console.log(userTweetsIdResponse);

    let userTweetIds = [];
    userTweetIds = userTweetsIdResponse.map((eachId) =>
      userTweetIds.push(eachId.tweet_id)
    );
    console.log(userTweetIds);

    if (userTweetIds.includes(tweetId)) {
      const deleteTweetQuery = `
            DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
