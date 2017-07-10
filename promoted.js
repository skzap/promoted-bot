var steem = require('steem') // for connecting to the steem blockchain
var jsonfile = require('jsonfile')

var config = jsonfile.readFileSync('./config.json')
if (!config.privkey || config.privkey.length < 5) throw('Please fill the config.json file')

// this bot saves the last upvote into a file so we can recover easily in case of shutdown
var save = jsonfile.readFileSync('./save.json')
var lastUpvoteTime = new Date(save[1].timestamp)
console.log(lastUpvoteTime)
console.log(save[0]+' is the last transaction # processed')

if (config.delegators) {
  // calculating and publishing shares of the @promoted account
  // in order to share curation rewards
  var delegatorsShares = []
  for (var i = 0; i < config.delegators.length; i++) {
    steem.api.getVestingDelegations(config.delegators[i], 999, 999, function(err, delegations) {
      for (var i = 0; i < delegations.length; i++) {
        if (delegations[i].delegatee == 'promoted') {
          delegatorsShares[delegations[i].delegator] = {vesting_shares: delegations[i].vesting_shares, min_delegation_time: delegations[i].min_delegation_time}
        }
      }
    });
  }

  setTimeout(function(){
    var totalVests = 0;
    for (var delegator in delegatorsShares) {
      totalVests += parseInt(delegatorsShares[delegator].vesting_shares.split(' ')[0])
    }
    for (var delegator in delegatorsShares) {
      delegatorsShares[delegator].percent = parseInt(delegatorsShares[delegator].vesting_shares.split(' ')[0]) / totalVests
    }
    var markdown = '|Delegator|Time|VESTS|Share|\n'
    markdown += '|---|---|---|---|\n'
    delegatorsShares = delegatorsShares.sort(function(a, b){console.log(a,b);return a.percent-b.percent});
    for (var delegator in delegatorsShares) {
      markdown += '|'+delegator+'|'+delegatorsShares[delegator].min_delegation_time+'|'+delegatorsShares[delegator].vesting_shares+'|'+delegatorsShares[delegator].percent+'|\n'
    }
    console.log(markdown)
  },10000)
}

setInterval(function() {
  steem.api.getAccountHistory('null', save[0]+config.limit, config.limit, function(err, history) {
    if (err) throw err;
    for (var i = 0; i < history.length; i++) {
      //console.log(err, history[i][0], history[i][1].timestamp, history[i][1].block, history[i][1].op)
      if (save[0] >= history[i][0]) continue;
      if (history[i][1].op[0] != 'transfer') throw 'Impossible error in theory';
      upvote(history[i])
    }
  });
}, config.refreshTime)

function upvote(transfer) {
  if (save[0] >= transfer[0]) return;
  if (new Date()-lastUpvoteTime < config.retryTime) {
    console.log(new Date()-lastUpvoteTime+'ms since last upvote, retrying in '+config.retryTime+'ms')
    setTimeout(function() {upvote(transfer)}, config.retryTime)
    return;
  }
  var author = transfer[1].op[1].memo.split('/')[0].replace('@','')
  var permlink = transfer[1].op[1].memo.split('/')[1]
  var amount = transfer[1].op[1].amount.split(' ')[0]
  var token = transfer[1].op[1].amount.split(' ')[1]
  if (token != 'SBD') console.log('NOT SBD')
  var weight = config.maxWeight
  if (amount < config.maxPrice) weight *= (amount/config.maxPrice) // reducing linearly
  weight = Math.ceil(weight)
  if (weight > config.maxWeight) weight = config.maxWeight
  if (weight < config.minWeight) weight = 0;
  if (!permlink || !author || !weight) {
    console.log('Invalid', transfer[0], transfer[1].timestamp, transfer[1].block, transfer[1].op)
    save = transfer
    return
  }
  console.log('Voting '+weight/100+'% '+author+'/'+permlink.substr(0,10))
  lastUpvoteTime = new Date()
  steem.broadcast.vote(
    config.privkey,
    config.user,
    author,
    permlink,
    weight,
    function(err, vote) {
      if (err) {
        console.log(err)
      }
      console.log('Voted! '+weight/100+'% '+author+'/'+permlink.substr(0,10))
      jsonfile.writeFile('./save.json', transfer, function (error) {
        if (error) throw error;
        save = transfer
      })
    }
  )
}
