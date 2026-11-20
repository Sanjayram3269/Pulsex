package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/crypto/bcrypt"
)

const authCookie = "pulsex_session"
const guestCookie = "pulsex_guest"
const loginTTL = 7 * 24 * time.Hour

var dummyPassword, _ = bcrypt.GenerateFromPassword([]byte("reserved non-account password"), 12)

func token(n int) string       { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func digest(raw string) string { b := sha256.Sum256([]byte(raw)); return hex.EncodeToString(b[:]) }
func validHex(raw string, n int) bool {
	if len(raw) != n {
		return false
	}
	_, err := hex.DecodeString(raw)
	return err == nil && raw == strings.ToLower(raw)
}
func validText(v string, min, max int) bool {
	n := utf8.RuneCountInString(v)
	if n < min || n > max || !utf8.ValidString(v) {
		return false
	}
	for _, r := range v {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return false
		}
	}
	return true
}
func singleLine(v string, min, max int) bool {
	return validText(v, min, max) && !strings.ContainsAny(v, "\n\t")
}
func cleanEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	a, err := mail.ParseAddress(email)
	return email, len(email) <= 254 && err == nil && a.Address == email && strings.Contains(email, "@")
}
func (s *Server) cookie(c *gin.Context, name, value string, age int) {
	http.SetCookie(c.Writer, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: age, HttpOnly: true, Secure: s.cfg.Secure, SameSite: http.SameSiteLaxMode})
}
func (s *Server) startLogin(ctx context.Context, c *gin.Context, u models.User) {
	raw := token(32)
	_, err := s.db.Logins.InsertOne(ctx, models.Login{Hash: digest(raw), UserID: u.ID, Expires: time.Now().Add(loginTTL)})
	if err != nil {
		dbError(c, err)
		return
	}
	s.cookie(c, authCookie, raw, int(loginTTL.Seconds()))
	c.JSON(200, u)
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func (s *Server) register(c *gin.Context) {
	var input credentials
	if !body(c, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	email, ok := cleanEmail(input.Email)
	if !ok || !singleLine(input.Name, 2, 60) || utf8.RuneCountInString(input.Password) < 10 || len(input.Password) > 72 {
		reject(c, "Enter a valid email, a name of 2–60 characters, and a password of 10 characters to 72 bytes.")
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(input.Password), 12)
	if err != nil {
		reject(c, "The password cannot be used.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	u := models.User{ID: bson.NewObjectID(), Name: input.Name, Email: email, Password: hashed}
	if _, err = s.db.Users.InsertOne(ctx, u); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			conflict(c, "This account could not be created. Try signing in.")
			return
		}
		dbError(c, err)
		return
	}
	s.startLogin(ctx, c, u)
}
func (s *Server) login(c *gin.Context) {
	var input credentials
	if !body(c, &input) {
		return
	}
	email, valid := cleanEmail(input.Email)
	if !valid || len(input.Password) == 0 || len(input.Password) > 72 {
		reject(c, "Enter a valid email and password.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	var u models.User
	err := s.db.Users.FindOne(ctx, bson.M{"email": email}).Decode(&u)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		dbError(c, err)
		return
	}
	hashed := u.Password
	if err != nil {
		hashed = dummyPassword
	}
	if bcrypt.CompareHashAndPassword(hashed, []byte(input.Password)) != nil || err != nil {
		fail(c, 401, "credentials", "Email or password is incorrect.")
		return
	}
	s.startLogin(ctx, c, u)
}
func (s *Server) identity(ctx context.Context, c *gin.Context) (bson.ObjectID, error) {
	raw, _ := c.Cookie(authCookie)
	if !validHex(raw, 64) {
		return bson.NilObjectID, mongo.ErrNoDocuments
	}
	var login models.Login
	err := s.db.Logins.FindOne(ctx, bson.M{"_id": digest(raw), "expires": bson.M{"$gt": time.Now()}}).Decode(&login)
	return login.UserID, err
}
func (s *Server) require(ctx context.Context, c *gin.Context) (bson.ObjectID, bool) {
	id, err := s.identity(ctx, c)
	if errors.Is(err, mongo.ErrNoDocuments) {
		fail(c, 401, "sign_in", "Sign in to continue.")
		return id, false
	}
	if err != nil {
		dbError(c, err)
		return id, false
	}
	return id, true
}
func (s *Server) logout(c *gin.Context) {
	raw, _ := c.Cookie(authCookie)
	if validHex(raw, 64) {
		ctx, cancel := request(c)
		defer cancel()
		if _, err := s.db.Logins.DeleteOne(ctx, bson.M{"_id": digest(raw)}); err != nil {
			dbError(c, err)
			return
		}
	}
	s.cookie(c, authCookie, "", -1)
	c.Status(204)
}
func (s *Server) me(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	id, ok := s.require(ctx, c)
	if !ok {
		return
	}
	var u models.User
	if err := s.db.Users.FindOne(ctx, bson.M{"_id": id}).Decode(&u); err != nil {
		dbError(c, err)
		return
	}
	c.JSON(200, u)
}
func (s *Server) profile(c *gin.Context) {
	var in struct {
		Name string `json:"name"`
	}
	if !body(c, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if !singleLine(in.Name, 2, 60) {
		reject(c, "Use a name of 2–60 characters.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	id, ok := s.require(ctx, c)
	if !ok {
		return
	}
	if _, err := s.db.Users.UpdateByID(ctx, id, bson.M{"$set": bson.M{"name": in.Name}}); err != nil {
		dbError(c, err)
		return
	}
	c.Status(204)
}
func (s *Server) guestSignature(id string) string {
	v := hmac.New(sha256.New, []byte(s.cfg.GuestSecret))
	_, _ = v.Write([]byte(id))
	return hex.EncodeToString(v.Sum(nil))
}
func (s *Server) guest(c *gin.Context, issue bool) string {
	raw, _ := c.Cookie(guestCookie)
	id, sig, ok := strings.Cut(raw, ".")
	if ok && validHex(id, 48) && hmac.Equal([]byte(s.guestSignature(id)), []byte(sig)) {
		return "g:" + digest(id)
	}
	if !issue {
		return ""
	}
	id = token(24)
	s.cookie(c, guestCookie, id+"."+s.guestSignature(id), 30*24*60*60)
	return "g:" + digest(id)
}
