// Package pool selects a usable account for a provider and reacts to outcomes.
package pool

import (
	"context"
	"errors"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/store"
)

var ErrNoAccount = errors.New("no usable account")

type Pool struct{ accounts store.AccountStore }

func New(a store.AccountStore) *Pool { return &Pool{accounts: a} }

// Pick returns the first active account for a provider.
func (p *Pool) Pick(ctx context.Context, providerName string) (provider.Account, error) {
	rows, err := p.accounts.List(ctx, providerName)
	if err != nil {
		return provider.Account{}, err
	}
	for _, a := range rows {
		if a.Status == "active" {
			return provider.Account{ID: a.ID, Secret: a.Secret, Creds: a.Creds}, nil
		}
	}
	return provider.Account{}, ErrNoAccount
}

// React applies an outcome to an account (ban/exhaust).
func (p *Pool) React(ctx context.Context, id int64, o provider.Outcome) {
	switch o {
	case provider.OutcomeDead:
		_ = p.accounts.SetStatus(ctx, id, "banned")
	case provider.OutcomeExhausted:
		_ = p.accounts.SetStatus(ctx, id, "exhausted")
	}
}
