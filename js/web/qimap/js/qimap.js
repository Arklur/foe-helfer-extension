/*
 * **************************************************************************************
 * Copyright (C) 2022 FoE-Helper team - All Rights Reserved
 * You may use, distribute and modify this code under the
 * terms of the AGPL license.
 *
 * See file LICENSE.md or go to
 * https://github.com/mainIine/foe-helfer-extension/blob/master/LICENSE.md
 * for full license details.
 *
 * **************************************************************************************
 */

FoEproxy.addWsHandler('GuildRaidsMapService', 'updateNodeCurrentProgress', async data => { 
    if (QIMap.CurrentRaidInstance === undefined) {
        // In case a "progress made on a node" event fires before the current level is loaded, we skip this WS call
        // Not the end of the world, shouldn't happen too often
    } else {
        // Update the "CurrentProgress" count on the node
        await QIMap.db.RaidInstanceNode.update(
            {
                SeasonEndsAtTimestamp: QIMap.CurrentRaidInstance.SeasonEndsAtTimestamp,
                DifficultyLevel: QIMap.CurrentRaidInstance.DifficultyLevel,
                NodeId: data.responseData.nodeId
            }, 
            {CurrentProgress: data.responseData.currentProgress});
    }
});

const QIMap = {
    CurrentMapData: {},
    NodeConnections: [],
    MaxX: 0,
    MaxY: 0,
    MinX: 100,
    MinY: 100,
    XMultiplier: 60,
    YMultiplier: 50,
    XOffset: 60,
    YOffset: 10,
    CurrentChampionship: undefined,
    CurrentSeason: undefined,
    CurrentRaidInstance: undefined,

	/**
	*
	* @returns {Promise<void>}
	*/
	checkForDB: async (playerID) => {
		const DBName = `FoeHelperDB_QI_${playerID}`;

		QIMap.db = new Dexie(DBName);

		QIMap.db.version(1).stores({
			Championship: 'EndsAtTimestamp', 
            //Additional columns: StartsAtDate, EndsAtDate

            Season: 'EndsAtTimestamp, ChampionshipEndsAtTimestamp',
            //Additional columns: GuildRaidsType

            RaidInstance: '[SeasonEndsAtTimestamp+DifficultyLevel], ChampionshipEndsAtTimestamp, DifficultyLevel',
            //Additional columns: RaidName

            RaidInstanceNode: '[SeasonEndsAtTimestamp+DifficultyLevel+NodeId], [SeasonEndsAtTimestamp+DifficultyLevel], \
                ChampionshipEndsAtTimestamp, SeasonEndsAtTimestamp, DifficultyLevel',
            //Additional columns: State, NodeType, ArmyType, FightType, Type, RequiredProgress, CurrentProgress

            RaidInstanceNodeLeaderboard: '[SeasonEndsAtTimestamp+DifficultyLevel+NodeId+PlayerId], \
                [SeasonEndsAtTimestamp+DifficultyLevel+NodeId], \
                [SeasonEndsAtTimestamp+DifficultyLevel], \
                ChampionshipEndsAtTimestamp, SeasonEndsAtTimestamp, DifficultyLevel, PlayerId'
            //Additional columns: PlayerName, Progress

        });

		QIMap.db.open();
		window.dispatchEvent(new CustomEvent('foe-helper#qimapDBloaded'))
	},

    /**
     * Initialize the MAP. responseData contains the nodes of the current level.
     * @param {*} responseData Response data
     */
    initCurrentLevel: async (responseData) => {
        QIMap.CurrentMapData = responseData;
        $('#qiMap-Btn').removeClass('hud-btn-red');

        // These must be defined, make sure we loaded the championship/season/raid data first
        if (QIMap.CurrentChampionship === undefined || QIMap.CurrentSeason === undefined || QIMap.CurrentRaidInstance === undefined) {
            // This should do the trick to make sure the Current thingies are loaded...likely there is a much more elegant/better approach
            console.warn("QIMap's Current stuff isn't loaded, waiting 2s...")
            await new Promise(r => setTimeout(r, 2000));
            //TODO: Using a Promise for initSeason and wait it to be "resolved"?
        }

        responseData.nodes.forEach(async node => {
            let raidInstanceNode = {
                SeasonEndsAtTimestamp: QIMap.CurrentSeason.EndsAtTimestamp,
                DifficultyLevel: QIMap.CurrentRaidInstance.DifficultyLevel,
                NodeId: node.id,
                ChampionshipEndsAtTimestamp: QIMap.CurrentChampionship.EndsAtTimestamp,
                State: node.state.state,
                NodeType: node.type.__class__,
                ArmyType: node.type.armyType,
                FightType: node.type.fightType,
                Type: node.type.type, // goods/units/resources? non-present when a fighting node
                RequiredProgress: node.type.requiredProgress,
                CurrentProgress: node.state.currentProgress || 0
            };

            // "Id" of RaidInstanceNode
            let raidInstanceNodeId = {
                SeasonEndsAtTimestamp: raidInstanceNode.SeasonEndsAtTimestamp,
                DifficultyLevel: raidInstanceNode.DifficultyLevel,
                NodeId: raidInstanceNode.NodeId
            };

            let currentRaidInstNode = await QIMap.db.RaidInstanceNode.get(raidInstanceNodeId);

            // If no record found, INSERT, otherwise UPDATE the progress count and/or state of the node
            if (currentRaidInstNode === undefined) {
                await QIMap.db.RaidInstanceNode.add(raidInstanceNode);
            } else if (currentRaidInstNode.CurrentProgress < raidInstanceNode.CurrentProgress 
                        || currentRaidInstNode.State != raidInstanceNode.State) {
                await QIMap.db.RaidInstanceNode.update(raidInstanceNodeId, {
                    CurrentProgress: raidInstanceNode.CurrentProgress,
                    State: raidInstanceNode.State
                });
            }

        }); // responseData.nodes.forEach(async node => {
    },

    /**
     * When loading the QI Map. Loads the main QI related stuff (Championship, Season and RaidInstance ("current level"))
     * @param {*} responseData Response data
     */
    initSeason: async (responseData) => {
        // Probably a good way to check if a season is running or we are between 2 seasons
        if (responseData.raidInstance !== undefined) {
            // Championship
            let championship = {
                EndsAtTimestamp: responseData.championship.endsAtTimestamp, 
                StartsAtDate: responseData.championship.startsAt,
                EndsAtDate: responseData.championship.endsAt
            };

            // Season
            let season = {
                EndsAtTimestamp: responseData.endsAt,
                ChampionshipEndsAtTimestamp: championship.EndsAtTimestamp,
                GuildRaidsType: responseData.guildRaidsType
            };

            // RaidInstance
            let raidInstance = {
                SeasonEndsAtTimestamp: season.EndsAtTimestamp,
                DifficultyLevel: responseData.raidInstance.difficultyLevel,
                ChampionshipEndsAtTimestamp: championship.EndsAtTimestamp,
                RaidName: responseData.raidInstance.raidName
            };

            // Check if we need to insert new entities
            QIMap.CurrentChampionship = await QIMap.db.Championship.get(championship.EndsAtTimestamp);
            QIMap.CurrentSeason       = await QIMap.db.Season.get(season.EndsAtTimestamp);
            QIMap.CurrentRaidInstance = await QIMap.db.RaidInstance.get(
                {
                    SeasonEndsAtTimestamp: raidInstance.SeasonEndsAtTimestamp, 
                    DifficultyLevel: raidInstance.DifficultyLevel
                });
            
            // If no entity found in the DB, insert and set as "Current" for all 3
            if (QIMap.CurrentChampionship === undefined) {
                QIMap.CurrentChampionship = championship;
                await QIMap.db.Championship.add(championship);
            }

            if (QIMap.CurrentSeason === undefined) {
                QIMap.CurrentSeason = season;
                await QIMap.db.Season.add(season);
            }

            if (QIMap.CurrentRaidInstance === undefined) {
                QIMap.CurrentRaidInstance = raidInstance;
                await QIMap.db.RaidInstance.add(raidInstance);
            }
        } // if (responseData.raidInstance !== undefined)
    },

    /**
     * WHen visiting a node and clicking on the leaderboard.
     * @param {*} responseData Response data
     * @param {*} postData Post data
     */
    loadNodeLeaderboard: async (responseData, postData) => {

        let nodeId;
        // Get the NodeId from the request's postData
        postData.forEach(postDataItem => {
            if (postDataItem.requestClass == 'GuildRaidsMapService' && postDataItem.requestMethod == 'getNodeLeaderboard') {
                nodeId = postDataItem.requestData[0]; //?...
            }
        })

        console.log(nodeId);

        // These must be defined, make sure we loaded the championship/season/raid data first
        if (QIMap.CurrentChampionship === undefined || QIMap.CurrentSeason === undefined || QIMap.CurrentRaidInstance === undefined) {
            // This should do the trick to make sure the Current thingies are loaded...likely there is a much more elegant/better approach
            console.warn("QIMap's Current stuff isn't loaded, waiting 2s...")
            await new Promise(r => setTimeout(r, 2000));
        }

        // Update leaderboard for each node as necessary
        responseData.rows.forEach(async row => {
            let raidInstanceNodeLeaderboard = {
                SeasonEndsAtTimestamp: QIMap.CurrentSeason.EndsAtTimestamp,
                DifficultyLevel: QIMap.CurrentRaidInstance.DifficultyLevel,
                NodeId: nodeId,
                PlayerId: row.player.player_id,
                ChampionshipEndsAtTimestamp: QIMap.CurrentChampionship.EndsAtTimestamp,
                PlayerName: row.player.name,
                Progress: row.progress || 0
            };

            await QIMap.db.RaidInstanceNodeLeaderboard.put(raidInstanceNodeLeaderboard);
        });
    },

    /**
     * Get which nodes should be visited for updated leaderboard data
     */
    getNodesToVisit: async() => {
        // Get the summarized node stats for the level
        const currentLevelNodes = await QIMap.db.RaidInstanceNode
            .where({
                SeasonEndsAtTimestamp: QIMap.CurrentRaidInstance.SeasonEndsAtTimestamp,
                DifficultyLevel: QIMap.CurrentRaidInstance.DifficultyLevel,
            }).toArray();

        // Get the details for each node on the current level
        const currentLevelNodeLeaderboards = await QIMap.db.RaidInstanceNodeLeaderboard
            .where({
                SeasonEndsAtTimestamp: QIMap.CurrentRaidInstance.SeasonEndsAtTimestamp,
                DifficultyLevel: QIMap.CurrentRaidInstance.DifficultyLevel,
            }).toArray();

        // Create a map to hold the sum of progress for each node
        const nodeProgressMap = currentLevelNodeLeaderboards.reduce((acc, entry) => {
            if (!acc[entry.NodeId]) {
                acc[entry.NodeId] = 0; // Initialize if the node is not in the map yet
            }
            acc[entry.NodeId] += entry.Progress || 0; // Sum the progress for the node
            return acc;
        }, {}); // Initial empty object


        // Iterate over the nodes and compare the progress (by "sum of leaderboard" and "current progress") of each node.
        // If the 2 value are different, it means that nodes needs to be visited to update the leaderboard numbers.
        for (const node of currentLevelNodes) {
            let nodeProgress = node.CurrentProgress,
                leaderboardSumProgress = nodeProgressMap[node.NodeId] || 0,
                nodeFullTypeLabel = '';

            if (node.NodeType.includes("Fight")) {
                nodeFullTypeLabel = `${node.NodeType} (${node.FightType}/${node.ArmyType})`
            } else if (node.NodeType.includes("Donation")) {
                nodeFullTypeLabel = `${node.NodeType} (${node.Type})`
            }

            // E.g.: Visit b5 (GuildRaidsMapNodeFight (mini-boss/defending) - 24/30)
            if (node.State != 'blocked' && node.NodeType != 'GuildRaidsMapNodeStart' && nodeProgress != leaderboardSumProgress) {
                console.log(`Visit ${node.NodeId} (${nodeFullTypeLabel} - ${leaderboardSumProgress}/${nodeProgress})`);
            }
        }
    },

	showBox: () => {

		if ($('#QIMap').length > 0) {
			HTML.CloseOpenBox('QIMap')
			return
		}

		HTML.AddCssFile('qimap')

		HTML.Box({
			id: 'QIMap',
			title: i18n('Boxes.QIMap.Title'),
			auto_close: true,
			dragdrop: true,
			minimize: true,
			resize: true
		})

		QIMap.initCurrentLevel(QIMap.CurrentMapData)
		QIMap.showBody()
	},

    showBody: () => {
        let out = '<div id="mapWrapper"><div id="nodeMap">'
        
		QIMap.Map = document.createElement("canvas");
		QIMap.MapCTX = QIMap.Map.getContext('2d');

		$(QIMap.Map).attr({
			id: 'nodeConnections',
			width: ProvinceMap.Size.width,
			height: ProvinceMap.Size.height,
		});

        QIMap.CurrentMapData.nodes.forEach(node => {
            let x = (node.position.x ? node.position.x : 0)
            QIMap.MaxX = (x > QIMap.MaxX ? x : QIMap.MaxX)
            QIMap.MaxY = ((node.position.y || 0) > QIMap.MaxY ? (node.position.y || 0) : QIMap.MaxY)
            QIMap.MinX = (x < QIMap.MinX ? x : QIMap.MinX)
            QIMap.MinY = ((node.position.y || 0) < QIMap.MinY ? (node.position.y || 0) : QIMap.MinY)

            node.connectedNodes.forEach(connection => {
                let findDuplicates = QIMap.NodeConnections.find(x => x.id == node.id && x.connectedNode == connection.targetNodeId)
                if (!findDuplicates) {
                    let newNode = {
                        id: node.id, 
                        nodePosition: node.position,
                        connectedNode: connection.targetNodeId, 
                        connectedNodePosition: connection.pathTiles
                    }
                    QIMap.NodeConnections.push(newNode)
                }
            })
        })
        
        QIMap.showNodeConnections()

        QIMap.CurrentMapData.nodes.forEach(node => {
            let x = (node.position.x - QIMap.MinX) * QIMap.XMultiplier + QIMap.XOffset || QIMap.XOffset
            let y = (node.position.y - QIMap.MinY) * QIMap.YMultiplier + QIMap.YOffset || QIMap.YOffset
            let type = (node.type.type !== undefined ? node.type.type : node.type.fightType)
            let currentProgress = (node.state.state === "open" ? (node.state.currentProgress || 0) + "/" : (node.state.state === "finished") ? node.type.requiredProgress + "/" : '')
            if (node.type.__class__ !== "GuildRaidsMapNodeStart") {
                out += '<span id="'+ node.id +'" style="left:'+x+'px;top:'+y+'px" class="'+node.state.state+ " " + type + " " + (node.type.armyType ? node.type.armyType : '') + (node.state.hasTarget ? ' target' : '') + '">'
                    out += '<span class="img"></span>'
                    out += '<b></b>'+currentProgress + node.type.requiredProgress
                    if (node.mapEffects?.effectActiveBeforeFinish?.boosts) {
                        out += '<br>'
                        node.mapEffects.effectActiveBeforeFinish.boosts.forEach(boost => {
                            out += '<i class="' + boost.type + '">' + boost.value + '</i> '
                        })
                    }
                    if (node.mapEffects?.effectActiveAfterFinish?.boosts) {
                        out += '<br>'
                        node.mapEffects.effectActiveAfterFinish.boosts.forEach(boost => {
                            out += '<i class="' + boost.type + '">' + boost.value + '</i> '
                        })
                    }
                out +='</span>'
            }
            else 
                out += '<span id="'+ node.id +'" style="left:'+x+'px;top:'+y+'px" class="start"><span class="img"></span></span>'
        })
        out += '</div></div>'
        
        $('#QIMap').find('#QIMapBody').html(out).promise().done(function () {
            $('#nodeMap').append(QIMap.Map)
            $('#nodeMap, #nodeConnections').css({'width': QIMap.MaxY*QIMap.XMultiplier+QIMap.XOffset+QIMap.XOffset+'px','height': QIMap.MaxY*QIMap.YMultiplier+QIMap.YOffset+120+'px'})
            QIMap.mapDrag()
        })
    },

    showNodeConnections: () => {
        QIMap.MapCTX.strokeStyle = '#000'
        QIMap.MapCTX.lineWidth = 3

        QIMap.NodeConnections.forEach(connection => {
            let prevX = '', prevY = ''
            for (const [i, path] of connection.connectedNodePosition.entries()) {
                let x = 0, y = 0, targetX = 0, targetY = 0
                if (prevX == '') {
                    x = ((connection.nodePosition.x || 0) - QIMap.MinX) * QIMap.XMultiplier + QIMap.XOffset + (((connection.nodePosition.x || 0) - QIMap.MinX)*50) || QIMap.XOffset
                    y = (connection.nodePosition.y - QIMap.MinY) * QIMap.YMultiplier + QIMap.YOffset + ((connection.nodePosition.y - QIMap.MinY)*50) || QIMap.YOffset +50
                }
                else {
                    x = prevX
                    y = prevY
                }

                targetX = ((path.x || 0) - QIMap.MinX) * QIMap.XMultiplier + QIMap.XOffset + (((path.x || 0) - QIMap.MinX)*50) || QIMap.XOffset
                targetY = (path.y - QIMap.MinY) * QIMap.YMultiplier + QIMap.YOffset + ((path.y - QIMap.MinY)*50) || QIMap.YOffset +50

                if (i === connection.connectedNodePosition.length-1) {
                    let longerX = (targetX != x ? 40 : 0)
                    let longerY = (targetY != y ? 30 : 0)

                    targetX = targetX + longerX
                    targetY = targetY + longerY
                }
    
                QIMap.MapCTX.beginPath()
                QIMap.MapCTX.moveTo(x, y)
                QIMap.MapCTX.lineTo(targetX, targetY)
                QIMap.MapCTX.closePath()
                QIMap.MapCTX.stroke()
                
                prevX = targetX, prevY = targetY
            }
        })
    },

	mapDrag: () => {
		const wrapper = document.getElementById('mapWrapper');
		let pos = { top: 0, left: 0, x: 0, y: 0 }
		
		const mouseDownHandler = function(e) {	
			pos = {
				left: wrapper.scrollLeft,
				top: wrapper.scrollTop,
				x: e.clientX,
				y: e.clientY,
			}
	
			document.addEventListener('mousemove', mouseMoveHandler)
			document.addEventListener('mouseup', mouseUpHandler)
		}
	
		const mouseMoveHandler = function(e) {
			const dx = e.clientX - pos.x
			const dy = e.clientY - pos.y
			wrapper.scrollTop = pos.top - dy
			wrapper.scrollLeft = pos.left - dx
		};
	
		const mouseUpHandler = function() {	
			document.removeEventListener('mousemove', mouseMoveHandler)
			document.removeEventListener('mouseup', mouseUpHandler)
		};

        QIMap.Map.addEventListener('mousedown', function (e) {
            wrapper.addEventListener('mousedown', mouseDownHandler)
        }, false)
	},
}