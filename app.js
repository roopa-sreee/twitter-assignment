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
    response.status(400);
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

const getLoggedInUserId = (username) => {
  const loggedInUserIdQuery = `
        SELECT user_id FROM user WHERE username='${username}';`;
  loggedInUserId = db.get(loggedInUserIdQuery);
  console.log(loggedInUserId);
  return loggedInUserId[0];
};

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserId = getLoggedInUserId(username);

  const getFeedQuery = `
        SELECT username, tweet, date_time AS dateTime 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id 
            INNER JOIN tweet ON user.user_id = tweet.user_id 
        WHERE follower.follower_user_id = ${loggedInUserId}
        ORDER BY tweet.date_time DESC 
        LIMIT 4;`;
  const feed = await db.all(getFeedQuery);
  response.send(feed);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserId = getLoggedInUserId(username);

  const getFollowingQuery = `
        SELECT username AS name 
        FROM user INNER JOIN follower ON user.user_id = follower.following_user_id
        WHERE follower.follower_user_id = ${loggedInUserId};`;
  const userFollowingQuery = await db.all(getFollowingQuery);
  response.send(userFollowingQuery);
});

app.get("/users/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserId = getLoggedInUserId(username);

  const getFollowersQuery = `
        SELECT username as name 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE follower.following_user_id = ${loggedInUserId};`;
  const followersArray = await db.all(getFollowersQuery);
  response.send(followersArray);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserId = getLoggedInUserId(username);
  const { tweetId } = request.params;
  const userOfTweetQuery = `
        SELECT user.user_id FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE tweet_id = ${tweetId};`;
  const tweetUserIdObject = await db.get(userOfTweetQuery);
  const tweetUserId = tweetUserIdObject[0];

  const userFollowingUserIdsQuery = `
        SELECT following_user_id 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';`;
  const followingUsersArray = await db.all(userFollowingUserIdsQuery);

  const isTweetValid = (tweetUserId, followingUsersArray) => {
    if (followingUsersArray.includes(tweetUserId)) {
      const responseTweetQuery = `
                SELECT 
                    tweet.tweet,
                    COUNT (like.like_id) AS likes ,
                    COUNT (reply.reply_id) AS replies,
                    tweet.date_time AS dateTime
                FROM tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
                INNER JOIN  reply ON tweet.tweet_id = reply.tweet_id
                WHERE tweet.tweet_id = ${tweetId};`;
      const tweet = db.get(responseTweetQuery);
      response.send(tweet);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  };
  isTweetValid();
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const loggedInUserId = getLoggedInUserId(username);
    const { tweetId } = request.params;
    const userOfTweetQuery = `
        SELECT user.user_id FROM user INNER JOIN tweet ON 
        user.user_id = tweet.user_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const tweetUserIdObject = await db.get(userOfTweetQuery);
    const tweetUserId = tweetUserIdObject[0];

    const userFollowingUserIdsQuery = `
        SELECT following_user_id 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';`;
    const followingUsersArray = await db.all(userFollowingUserIdsQuery);

    const IsTweetValid = (tweetUserId, followingUsersArray) => {
      if (followingUsersArray.includes(tweetUserId)) {
        const likedUsersQuery = `
                SELECT username AS likes
                FROM user NATURAL JOIN like 
                WHERE tweet_id= ${tweetId};`;
        const likedUsers = db.all(likedUsersQuery);
        response.send(likedUsers);
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    };
    isTweetValid();
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const loggedInUserId = getLoggedInUserId(username);
    const { tweetId } = request.params;
    const userOfTweetQuery = `
        SELECT user.user_id FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE tweet_id = ${tweetId};`;
    const tweetUserIdObject = await db.get(userOfTweetQuery);
    const tweetUserId = tweetUserIdObject[0];

    const userFollowingUserIdsQuery = `
        SELECT following_user_id 
        FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';`;
    const followingUsersArray = await db.all(userFollowingUserIdsQuery);

    const isTweetValid = (tweetUserId, followingUsersArray) => {
      if (followingUsersArray.includes(tweetUserId)) {
        const repliesQuery = `
                SELECT username AS name , reply.reply 
                FROM user INNER JOIN reply ON user.user_id = reply.user_id
                WHERE tweet_id = ${tweetId};`;
        const repliesArray = db.all(repliesQuery);
        response.send(`replies:${repliesArray}`);
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    };
    isTweetValid();
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserId = getLoggedInUserId(username);

  const userTweetsQuery = `
        SELECT 
            tweet,
            COUNT(like_id) AS likes,
            COUNT(reply) AS replies,
            tweet.date_time AS dateTime
        FROM tweet NATURAL JOIN like NATURAL JOIN reply 
        WHERE tweet.user_id = ${loggedInUserId}
        GROUP BY tweet_id;`;
  const tweetsArray = await db.all(userTweetsQuery);
  response.send(tweetsArray);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserId = getLoggedInUserId(username);
  const newTweet = request.body;
  const dateTime = new Date();

  const addTweetQuery = `
        INSERT INTO tweet (tweet,user_id,date_time)
        VALUES ('${newTweet}',${loggedInUserId},${dateTime});`;
  await db.run(addTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const loggedInUserId = getLoggedInUserId(username);
    const { tweetId } = request.params;

    const getUserTweetsQuery = ` 
        SELECT tweet_id FROM tweet WHERE user_id = ${loggedInUserId};`;
    const userTweetsIds = await db.all(getUserTweetsQuery);

    if (userTweetsIds.includes(tweetId)) {
      const deleteTweetQuery = `
            DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
      db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
