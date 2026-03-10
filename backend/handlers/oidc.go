package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/devops-kubeadjust/backend/oidc"
)

// OIDCHandler handles OIDC login URL generation and authorization code exchange.
type OIDCHandler struct {
	oauth2Cfg oauth2.Config
	verifier  *gooidc.IDTokenVerifier
	secret    []byte
}

// NewOIDCHandler initialises the OIDC handler by fetching the provider discovery document.
// Returns an error if the provider is unreachable or misconfigured.
func NewOIDCHandler(issuerURL, clientID, clientSecret, redirectURL string, secret []byte) (*OIDCHandler, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	provider, err := gooidc.NewProvider(ctx, issuerURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC provider init (%s): %w", issuerURL, err)
	}

	return &OIDCHandler{
		verifier: provider.Verifier(&gooidc.Config{ClientID: clientID}),
		oauth2Cfg: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Endpoint:     provider.Endpoint(),
			Scopes:       []string{gooidc.ScopeOpenID, "email", "profile"},
		},
		secret: secret,
	}, nil
}

// LoginURL generates a fresh OIDC authorization URL with a random state.
// GET /api/auth/loginurl — called server-side by the Next.js frontend, not by the browser.
func (h *OIDCHandler) LoginURL() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state, err := oidc.GenerateState()
		if err != nil {
			log.Printf("OIDC state generation failed: %v", err)
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"authUrl": h.oauth2Cfg.AuthCodeURL(state),
			"state":   state,
		}); err != nil {
			log.Printf("OIDC loginurl encode error: %v", err)
		}
	}
}

// CreateSession exchanges an OIDC authorization code for a signed session token.
// POST /api/auth/session — called server-side by the Next.js frontend, not by the browser.
func (h *OIDCHandler) CreateSession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
			jsonError(w, "missing code", http.StatusBadRequest)
			return
		}

		oauth2Token, err := h.oauth2Cfg.Exchange(r.Context(), body.Code)
		if err != nil {
			log.Printf("OIDC code exchange failed: %v", err)
			jsonError(w, "authentication failed", http.StatusUnauthorized)
			return
		}

		rawIDToken, ok := oauth2Token.Extra("id_token").(string)
		if !ok {
			log.Println("OIDC: missing id_token in token response")
			jsonError(w, "authentication failed", http.StatusUnauthorized)
			return
		}

		idToken, err := h.verifier.Verify(r.Context(), rawIDToken)
		if err != nil {
			log.Printf("OIDC ID token verification failed: %v", err)
			jsonError(w, "authentication failed", http.StatusUnauthorized)
			return
		}

		sessionToken, err := oidc.CreateSessionToken(idToken.Subject, h.secret, 8*time.Hour)
		if err != nil {
			log.Printf("session token creation failed: %v", err)
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}

		log.Printf("OIDC session issued: subject=%q remote=%s", idToken.Subject, r.RemoteAddr)

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"token": sessionToken}); err != nil {
			log.Printf("OIDC session encode error: %v", err)
		}
	}
}

// AuthConfig returns OIDC enablement status. Always public, no auth required.
// GET /api/auth/config
func AuthConfig(oidcEnabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]bool{"oidcEnabled": oidcEnabled}); err != nil {
			log.Printf("auth config encode error: %v", err)
		}
	}
}
