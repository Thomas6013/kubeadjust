package oidc

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidToken = errors.New("invalid session token")
	ErrTokenExpired = errors.New("session token expired")
)

type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type jwtClaims struct {
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

func b64(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

// CreateSessionToken creates a signed HS256 JWT with the given subject and TTL.
func CreateSessionToken(subject string, secret []byte, ttl time.Duration) (string, error) {
	now := time.Now()
	header, _ := json.Marshal(jwtHeader{Alg: "HS256", Typ: "JWT"})
	claims, _ := json.Marshal(jwtClaims{
		Sub: subject,
		Iat: now.Unix(),
		Exp: now.Add(ttl).Unix(),
	})

	payload := b64(header) + "." + b64(claims)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return payload + "." + b64(mac.Sum(nil)), nil
}

// VerifySessionToken validates the signature and expiry of a session token.
// Returns the subject on success.
func VerifySessionToken(token string, secret []byte) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", ErrInvalidToken
	}

	payload := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	if !hmac.Equal([]byte(parts[2]), []byte(b64(mac.Sum(nil)))) {
		return "", ErrInvalidToken
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", ErrInvalidToken
	}
	var claims jwtClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return "", ErrInvalidToken
	}
	if time.Now().Unix() > claims.Exp {
		return "", ErrTokenExpired
	}
	return claims.Sub, nil
}

// GenerateState returns a cryptographically random URL-safe string for OIDC state.
func GenerateState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
