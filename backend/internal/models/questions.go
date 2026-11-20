package models

import "sort"

const (
	SingleChoice   = "single_choice"
	MultipleChoice = "multiple_choice"
	Rating         = "rating"
	RankedChoice   = "ranked_choice"
	WordCloud      = "word_cloud"
)

// Question is absent on existing V1 polls. Their choices and votes retain their original meaning.
type Question struct {
	Version int    `bson:"version" json:"version"`
	Type    string `bson:"type" json:"type"`
	Min     int    `bson:"min,omitempty" json:"min,omitempty"`
	Max     int    `bson:"max,omitempty" json:"max,omitempty"`
}

type TermCount struct {
	Text  string `bson:"text" json:"text"`
	Count int64  `bson:"count" json:"count"`
}

func (p Poll) QuestionType() string {
	if p.Question == nil {
		return SingleChoice
	}
	return p.Question.Type
}

func (p Poll) BallotCount() int64 {
	if p.Question != nil {
		return p.Ballots
	}
	var total int64
	for _, n := range p.Counts {
		total += n
	}
	return total
}

func (p Poll) Snapshot() Snapshot {
	result := Snapshot{Version: p.Version, Counts: p.Counts, RankPoints: p.RankPoints, Ballots: p.BallotCount()}
	if p.QuestionType() != WordCloud {
		return result
	}

	result.Ballots = 0
	result.Terms = make([]TermCount, 0, len(p.Terms))
	for _, term := range p.Terms {
		result.Terms = append(result.Terms, term)
		result.Ballots += term.Count
	}
	sort.Slice(result.Terms, func(i, j int) bool {
		a, b := result.Terms[i], result.Terms[j]
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		return a.Text < b.Text
	})
	return result
}
